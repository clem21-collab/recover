const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../supabase/functions/_shared/invoice-validation.js');
const validation = globalThis.RecoverInvoiceValidation;
const source = fs.readFileSync(require('node:path').join(__dirname, '../cloud.js'), 'utf8');
function merge(local, ai, manual = {}) {
  const context = {
    RecoverInvoiceValidation: validation, window: {},
    document: { readyState: 'loading', addEventListener() {}, querySelector: id => ({ value: manual[id] || '' }) }
  };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.merge = mergeAi;})();'), context);
  return JSON.parse(JSON.stringify(context.merge(local, ai)));
}

test('Validation rejette dates, types, identifiants, en-têtes et valeurs non finies', () => {
  const result = validation.validateAnalysis({
    merchant: 'Amazon', product: 'Référence', orderNumber: 'commande',
    invoiceDate: '2026-02-31', price: '29,95', ht: Infinity, vatRate: 120,
    seller: '<script>alert(1)</script>', category: 'inventée', confidence: { merchant: 100 }
  });
  assert.equal(result.merchant, 'Amazon');
  assert.equal(result.confidence.merchant, 95);
  for (const field of ['product', 'orderNumber', 'invoiceDate', 'price', 'ht', 'vatRate', 'seller', 'category']) {
    assert.equal(result[field], undefined, field);
    assert.ok(result.validationWarnings.includes(field));
  }
  assert.throws(() => validation.validateAnalysis({}), /aucun champ valide/);
});

test('Une IA peu fiable ne remplit pas les champs absents et ne relève pas la confiance locale', () => {
  const result = merge({ product: 'Filet CargoVA', price: 29.95, confidence: { product: 90, price: 85 } }, {
    product: 'Autre produit', price: 999, invoiceNumber: 'FA-1234',
    confidence: { product: 20, price: 20, invoiceNumber: 20 }
  });
  assert.equal(result.product, 'Filet CargoVA');
  assert.equal(result.price, 29.95);
  assert.equal(result.invoiceNumber, undefined);
  assert.equal(result.confidence.price, 85);
});

test('Un désaccord reste signalé et sa confiance reste prudente', () => {
  const result = merge({ price: 29.95, confidence: { price: 92 } }, {
    price: 39.95, confidence: { price: 95 }, evidence: { price: 'Total TTC : 39,95 €' }
  });
  assert.equal(result.price, 39.95);
  assert.equal(result.fieldConflicts[0].local, 29.95);
  assert.equal(result.confidence.price, 60);
  assert.equal(result.fieldConfidence.price, 60);
});

test('La fusion complète les absences et conserve les saisies manuelles', () => {
  const result = merge({ merchant: 'Amazon', seller: '', product: 'Achat / service' }, {
    seller: 'Evom OÜ', product: 'Filet CargoVA pour remorque', invoiceDate: '2026-10-25',
    confidence: { seller: 90, product: 90, invoiceDate: 90 }
  }, { '#product': 'Mon produit', '#price': '0' });
  assert.equal(result.seller, 'Evom OÜ');
  assert.equal(result.product, 'Mon produit');
  assert.equal(result.price, 0);
  assert.equal(result.fieldSources.product, 'manual');
  assert.equal(result.purchaseDate, '2026-10-25');
});

test('Le marchand ne devient jamais automatiquement vendeur', () => {
  assert.equal(merge({ merchant: 'Boulanger' }, { merchant: 'Boulanger', confidence: { merchant: 90 } }).seller, undefined);
});

test('TVA et total incohérents sont signalés sans recalcul', () => {
  const result = merge({ price: 19.9, ht: 12.42, vatAmount: 2.48 }, { merchant: 'Promovap', confidence: { merchant: 85 } });
  assert.equal(result.ht, 12.42);
  assert.equal(result.financialWarnings.length, 1);
  assert.equal(validation.financialWarnings({ price: 19.9, itemsSubtotalHT: 12.42, vatAmount: 2.48, shippingTTC: 5 }).length, 0);
});

test('Les lignes IA sont bornées et les attributs inattendus ne sont pas propagés', () => {
  const ai = validation.validateAnalysis({
    price: 10, unexpected: 'ne pas conserver', lineItems: [
      { description: 'Référence', quantity: 1 },
      { description: 'Article utile', quantity: '2', totalTTC: -10 }
    ], confidence: { price: 90 }
  });
  assert.equal(ai.unexpected, undefined);
  assert.equal(ai.lineItems.length, 1);
  assert.equal(ai.lineItems[0].quantity, null);
  assert.equal(ai.lineItems[0].totalTTC, null);
});
