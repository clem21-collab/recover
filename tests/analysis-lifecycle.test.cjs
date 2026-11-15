const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../supabase/functions/_shared/invoice-validation.js');
const validation = globalThis.RecoverInvoiceValidation;

function harness(invoke, extract = async () => '') {
  const elements = {};
  function node() {
    return {
      children: [], disabled: false, textContent: '',
      querySelector(selector) { return selector.startsWith('#') ? elements[selector] || null : null; },
      prepend(child) { this.children.unshift(child); if (child.id) elements['#' + child.id] = child; },
      appendChild(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      remove() { delete elements['#' + this.id]; }
    };
  }
  const button = elements['#recover-ai-check'] = node();
  elements['#result-content'] = node();
  const dialog = elements['#analysis-result-dialog'] = { open: true, close() { this.open = false; } };
  elements['#file-input'] = { files: [{ name: 'test.png', size: 100, lastModified: 1, type: 'image/png' }] };
  let displayed;
  const window = {
    extractFile: extract, RecoverParser: { parse: () => ({ merchant: 'Test', confidence: { merchant: 50 } }) },
    showResult(value) { displayed = value; dialog.open = true; },
    supabase: { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: {} } }) }, functions: { invoke }
    }) }
  };
  const context = {
    window, RecoverInvoiceValidation: validation, console: { error() {} }, setTimeout,
    localStorage: { getItem: key => key.includes('consent') ? 'yes' : '{}' },
    document: { readyState: 'loading', addEventListener() {}, createElement: node,
      querySelector: selector => elements[selector] || null }
  };
  const cloud = fs.readFileSync(path.join(__dirname, '../cloud.js'), 'utf8');
  vm.runInNewContext(cloud.replace(/\}\)\(\);\s*$/, 'previewImages = async () => ["data:image/png;base64,AAAA"]; globalThis.run = runVisualAi;})();'), context);
  return { run: () => context.run(true), button, dialog, elements, displayed: () => displayed };
}

test('Le bouton redevient utilisable après une analyse réussie', async () => {
  const h = harness(async () => ({ data: { analysis: { price: 19.9, confidence: { price: 90 } }, model: 'test' } }));
  await h.run();
  assert.equal(h.displayed().price, 19.9);
  assert.equal(h.button.disabled, false);
  assert.match(h.button.textContent, /Vérifier à nouveau/);
});

test('Erreur HTTP ou préparation impossible — résultat local conservé et bouton réactivé', async () => {
  for (const failEarly of [false, true]) {
    const h = harness(async () => ({ error: { context: Response.json({ error: 'Service indisponible' }, { status: 503 }) } }),
      failEarly ? async () => { throw new Error('Lecture impossible'); } : undefined);
    await h.run();
    assert.equal(h.displayed(), undefined);
    assert.equal(h.dialog.open, true);
    assert.equal(h.button.disabled, false);
    assert.match(h.button.textContent, /Vérifier avec/);
    const banner = h.elements['#recover-ai-running'];
    assert.match(banner.children[1].textContent, failEarly ? /Lecture impossible/ : /HTTP 503/);
  }
});

test('Un double clic pendant la lecture ne déclenche pas deux appels', async () => {
  let release;
  let calls = 0;
  const reading = new Promise(resolve => { release = resolve; });
  const h = harness(async () => { calls++; return { data: { analysis: { price: 19.9, confidence: { price: 90 } } } }; },
    () => reading);
  const first = h.run();
  await h.run();
  release('');
  await first;
  assert.equal(calls, 1);
});

test('Une réponse tardive ne remplace pas le résultat d’un autre fichier', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const h = harness(() => response);
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  h.elements['#file-input'].files = [{ name: 'autre.pdf', size: 200, lastModified: 2 }];
  release({ data: { analysis: { price: 19.9, confidence: { price: 90 } } } });
  await pending;
  assert.equal(h.displayed(), undefined);
  assert.equal(h.dialog.open, true);
  assert.equal(h.button.disabled, false);
});

test('Enregistrement sans date — aucune date du jour ajoutée à l’achat', async () => {
  const elements = {
    '#seller-type': { value: 'unknown' }, '#purchase-channel': { value: 'unknown' },
    '#delivery-date': { value: '' }, '#commercial-warranty-months': { value: '' },
    '#analysis-result-dialog': { close() {} }
  };
  const script = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').replace(/boot\(\);\s*$/, '');
  const context = {
    window: {}, document: { querySelector: selector => elements[selector] }, structuredClone,
    localStorage: { setItem() {} }, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto
  };
  vm.runInNewContext(script + '\npending={merchant:"Test",product:"Produit",price:10,purchaseDate:""}; render=()=>{}; toast=()=>{}; globalThis.saveTest=savePending; globalThis.readState=()=>state;', context);
  await context.saveTest();
  assert.equal(context.readState().purchases[0].purchaseDate, '');
  assert.equal(context.readState().purchases[0].price, 10);
});

test('Les résultats présentent les champs absents et incertains sans texte non échappé', () => {
  const elements = {
    '#result-content': { innerHTML: '' },
    '#analysis-result-dialog': { showModal() {} }
  };
  const script = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').replace(/boot\(\);\s*$/, '');
  const context = {
    window: {}, document: { querySelector: selector => elements[selector] }, structuredClone,
    RecoverInvoiceValidation: validation
  };
  vm.runInNewContext(script + '\nglobalThis.showTest=showResult;', context);
  context.showTest({
    merchant: '<script>alert(1)</script>', product: 'Produit à vérifier', price: 19.9,
    purchaseDate: '', orderNumber: '', confidence: { product: 50, price: 90 },
    invoiceNumber: '', genericFields: [], lineItems: []
  });
  const html = elements['#result-content'].innerHTML;
  assert.match(html, /À vérifier/);
  assert.match(html, /Absent/);
  assert.match(html, /19,90/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Répartition du montant/);
});
