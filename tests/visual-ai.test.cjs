const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');

const cloudSource = readFileSync(join(__dirname, '../cloud.js'), 'utf8');
const functionSource = stripTypeScriptTypes(readFileSync(
  join(__dirname, '../supabase/functions/recover-visual-ai/index.ts'), 'utf8'
).replace(/^import[^\n]+\n/, ''));

function client(invoke) {
  const window = { supabase: { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: {} } }) },
    functions: { invoke }
  }) } };
  runInNewContext(cloudSource, {
    window,
    localStorage: { getItem: () => '{}' },
    document: { readyState: 'loading', addEventListener() {} }
  });
  return window.RecoverCloud;
}

test('Le client remonte le détail JSON et le statut HTTP', async () => {
  const context = Response.json({ error: 'Session Recover invalide.' }, { status: 401 });
  const cloud = client(async () => ({ error: { context, message: 'non-2xx' } }));
  await assert.rejects(cloud.visualAnalyze({}), /HTTP 401 · Session Recover invalide\./);
});

test('Le client conserve une erreur réseau sans réponse HTTP', async () => {
  const error = new Error('Connexion interrompue');
  const cloud = client(async () => ({ error }));
  await assert.rejects(cloud.visualAnalyze({}), failure => failure === error);
});

function simulateGemini(responses, signals = AbortSignal) {
  const models = [];
  const env = { GEMINI_MODEL: 'configured-model' };
  const analyze = runInNewContext(functionSource + '\nanalyzeWithFallback', {
    Deno: { env: { get: key => env[key] }, serve() {} },
    AbortSignal: signals,
    console: { error() {}, warn() {} },
    fetch: async (url, { signal }) => {
      models.push(url.match(/\/models\/([^:]+)/)[1]);
      assert.ok(responses.length, 'appel Gemini inattendu');
      const response = responses.shift();
      return typeof response === 'function' ? response(signal) : response;
    }
  });
  return { run: () => analyze('fake-key', []), models };
}

test('Un modèle trop lent laisse une tentative au modèle suivant', async () => {
  const signals = {
    timeout: ms => AbortSignal.timeout(ms === 12_000 ? 1 : ms),
    any: AbortSignal.any
  };
  const simulation = simulateGemini([
    signal => new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('Délai de test dépassé')), 1000);
      signal.addEventListener('abort', () => {
        clearTimeout(keepAlive);
        reject(signal.reason);
      }, { once: true });
    }),
    Response.json({ candidates: [{ content: { parts: [{ text: '{"price":19.9}' }] } }] })
  ], signals);
  assert.equal((await simulation.run()).analysis.price, 19.9);
  assert.deepEqual(simulation.models, ['configured-model', 'gemini-3.8-flash']);
});

test('Gemini poursuit après un modèle introuvable et une analyse inexploitable', async () => {
  const simulation = simulateGemini([
    Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 }),
    Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
    Response.json({ candidates: [{ content: { parts: [{ text: '{"price":19.9}' }] } }] })
  ]);
  assert.equal((await simulation.run()).analysis.price, 19.9);
  assert.deepEqual(simulation.models, ['configured-model', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
});

test('Gemini remonte le refus avec son code sans réessayer ni exposer le corps amont', async () => {
  const simulation = simulateGemini([
    Response.json({ error: { status: 'PERMISSION_DENIED', message: 'détail confidentiel' } }, { status: 403 })
  ]);
  await assert.rejects(simulation.run(), { message: 'Gemini configured-model a renvoyé HTTP 403 · PERMISSION_DENIED.' });
  assert.deepEqual(simulation.models, ['configured-model']);
});
