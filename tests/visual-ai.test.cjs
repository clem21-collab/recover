const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');

require('../supabase/functions/_shared/invoice-validation.js');
const validation = globalThis.RecoverInvoiceValidation;
const cloudSource = readFileSync(join(__dirname, '../cloud.js'), 'utf8');
const functionSource = stripTypeScriptTypes(readFileSync(
  join(__dirname, '../supabase/functions/recover-visual-ai/index.ts'), 'utf8'
).replace(/^import[^\n]+\n/gm, ''));

function client(invoke) {
  const window = { supabase: { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: {} } }) },
    functions: { invoke }
  }) } };
  runInNewContext(cloudSource, {
    window,
    RecoverInvoiceValidation: validation,
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
  const delays = [];
  const env = { GEMINI_MODEL: 'configured-model' };
  const analyze = runInNewContext(functionSource + '\nanalyzeWithFallback', {
    Deno: { env: { get: key => env[key] }, serve() {} },
    AbortSignal: signals,
    RecoverInvoiceValidation: validation,
    setTimeout: (callback, delay) => { delays.push(delay); return setTimeout(callback, 0); },
    console: { error() {}, warn() {} },
    fetch: async (url, { signal }) => {
      models.push(url.match(/\/models\/([^:]+)/)[1]);
      assert.ok(responses.length, 'appel Gemini inattendu');
      const response = responses.shift();
      return typeof response === 'function' ? response(signal) : response;
    }
  });
  return { run: () => analyze('fake-key', []), models, delays };
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

test('Gemini remonte le refus avec son code sans réessayer et avec le détail amont', async () => {
  const simulation = simulateGemini([
    Response.json({ error: { status: 'PERMISSION_DENIED', message: 'détail confidentiel' } }, { status: 403 })
  ]);
  await assert.rejects(simulation.run(), { message: 'Gemini configured-model a renvoyé HTTP 403 · PERMISSION_DENIED. détail confidentiel' });
  assert.deepEqual(simulation.models, ['configured-model']);
});

test('503 temporaire — deux essais puis basculement', async () => {
  const unavailable = () => Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 });
  const simulation = simulateGemini([
    unavailable(), unavailable(),
    Response.json({ candidates: [{ content: { parts: [{ text: '{"price":19.9}' }] } }] })
  ]);
  assert.equal((await simulation.run()).analysis.price, 19.9);
  assert.deepEqual(simulation.models, ['configured-model', 'configured-model', 'gemini-3.8-flash']);
  assert.ok(simulation.delays[0] >= 800 && simulation.delays[0] < 1100);
});

test('429 quota — aucun essai supplémentaire, détail et délai conservés', async () => {
  const simulation = simulateGemini([
    Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota journalier dépassé' } },
      { status: 429, headers: { 'Retry-After': '60' } })
  ]);
  await assert.rejects(simulation.run(), error =>
    error.status === 429 && error.retryAfter === 60 && /Quota journalier/.test(error.message));
  assert.deepEqual(simulation.models, ['configured-model']);
  assert.deepEqual(simulation.delays, []);
});

test('Retry-After long — le serveur respecte le délai sans rafale de requêtes', async () => {
  const simulation = simulateGemini([
    Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503, headers: { 'Retry-After': '30' } })
  ]);
  await assert.rejects(simulation.run(), error => error.status === 503 && error.retryAfter === 30);
  assert.equal(simulation.models.length, 1);
});

test('Une erreur réseau permet le modèle suivant', async () => {
  const simulation = simulateGemini([
    () => { throw new TypeError('Network error'); },
    Response.json({ candidates: [{ content: { parts: [{ text: '{"price":19.9}' }] } }] })
  ]);
  assert.equal((await simulation.run()).analysis.price, 19.9);
  assert.equal(simulation.models.length, 2);
});

test('Une sortie JSON invalide est rejetée avant le basculement', async () => {
  const simulation = simulateGemini([
    Response.json({ candidates: [{ content: { parts: [{ text: '{"price":"inventé","product":"Référence"}' }] } }] }),
    Response.json({ candidates: [{ content: { parts: [{ text: '{"price":19.9}' }] } }] })
  ]);
  assert.equal((await simulation.run()).analysis.price, 19.9);
  assert.equal(simulation.models.length, 2);
});

test('Une clé accidentellement renvoyée par Google est masquée', async () => {
  const simulation = simulateGemini([
    Response.json({ error: { status: 'PERMISSION_DENIED', message: 'Invalid API key fake-key' } }, { status: 403 })
  ]);
  await assert.rejects(simulation.run(), error => !error.message.includes('fake-key') && error.message.includes('[clé masquée]'));
});

test('La fonction vérifie authentification, JSON et images avant tout appel Gemini', async () => {
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public', GEMINI_API_KEY: 'fake-key' };
  runInNewContext(functionSource, {
    Deno: { env: { get: key => env[key] }, serve: value => { handler = value; } },
    RecoverInvoiceValidation: validation, Response, AbortSignal,
    console: { error() {}, warn() {} },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) } })
  });
  const request = (body, auth = true) => new Request('https://example.com', {
    method: 'POST', headers: auth ? { Authorization: 'Bearer test' } : {}, body
  });
  assert.equal((await handler(request('{}', false))).status, 401);
  assert.equal((await handler(request('invalid'))).status, 400);
  assert.equal((await handler(request('{"images":[]}'))).status, 400);
  assert.equal((await handler(request('{"images":["data:image/svg+xml;base64,AAAA"]}'))).status, 400);
  delete env.GEMINI_API_KEY;
  assert.equal((await handler(request('{}'))).status, 503);
});
