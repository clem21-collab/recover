const { test } = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('../parser.js');
const { parse, isoDate, amount } = window.RecoverParser;

// Representative excerpts reconstructed from the supplied reference values.
// These are not assertions about PDFs unavailable in this checkout.
const amazon = [
  'AMAZON EU S.À R.L.',
  'Facture',
  'Vendu par : Evom OÜ',
  'Date de commande : 24/10/2026',
  'Date de facture : 25/10/2026',
  'Numéro de commande : 402-1234567-7654321',
  'N° facture : INV-2026-1234',
  'Description\tQté\tTotal TTC',
  'Filet CargoVA pour remorque\t1\t29,95 €',
  'Total HT : 24,96 €',
  'TVA 20 % : 4,99 €',
  'Total TTC : 29,95 €'
].join('\n');
const boulanger = [
  'Boulanger',
  'Date facture : 17/12/2025',
  'Référence\tDésignation\tQuantité\tTotal TTC',
  '123456\tLunettes connectées Ray-Ban Meta Headline\t1\t499,00 €',
  'Total HT : 415,83 €',
  'TVA 20 % : 83,17 €',
  'Total TTC : 499,00 €',
  'Garantie réparation jusqu’au : 17/12/2027'
].join('\n');

test('Référence Amazon — vendeur distinct, filet CargoVA et TVA', () => {
  const p = parse(amazon);
  assert.equal(p.merchant, 'Amazon');
  assert.equal(p.seller, 'Evom OÜ');
  assert.equal(p.product, 'Filet CargoVA pour remorque');
  assert.equal(p.purchaseDate, '2026-10-24');
  assert.equal(p.invoiceDate, '2026-10-25');
  assert.deepEqual([p.price, p.ht, p.vatAmount, p.vatRate], [29.95, 24.96, 4.99, 20]);
  assert.equal(p.deliveryDate, '');
});

test('Référence Boulanger — Ray-Ban, TVA et garantie réparation', () => {
  const p = parse(boulanger);
  assert.equal(p.product, 'Lunettes connectées Ray-Ban Meta Headline');
  assert.equal(p.invoiceDate, '2025-12-17');
  assert.equal(p.commercialWarrantyEnd, '2027-12-17');
  assert.deepEqual([p.price, p.ht, p.vatAmount, p.vatRate], [499, 415.83, 83.17, 20]);
  assert.equal(p.orderNumber, '');
});

test('Dates multicolonnes — commande, facture, expédition et livraison', () => {
  const p = parse([
    'Atelier Exemple',
    'Date de commande\tDate de facture\tDate d’expédition\tDate de livraison',
    '24/10/2026\t25/10/2026\t26/10/2026\t28/10/2026',
    'N° client\tN° facture',
    'CL-1200\tFA-2200'
  ].join('\n'));
  assert.deepEqual([p.purchaseDate, p.invoiceDate, p.shippingDate, p.deliveryDate],
    ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-28']);
  assert.equal(p.clientNumber, 'CL-1200');
  assert.equal(p.invoiceNumber, 'FA-2200');
});

test('En-têtes, adresses et pied de page ne deviennent pas des produits', () => {
  const p = parse('Facture\nAdresse de livraison\tAdresse de facturation\n12 rue Exemple\t34 rue Exemple\n75000 PARIS\nRéférence\nConditions générales');
  assert.equal(p.product, 'Achat / service');
  assert.equal(p.merchant, 'Prestataire non identifié');
  assert.equal(p.orderNumber, '');
  assert.equal(p.purchaseDate, '');
  assert.equal(p.price, null);
  assert.deepEqual(p.genericFields, []);
});

test('Un service et un produit sur plusieurs lignes gardent leurs noms', () => {
  assert.equal(parse('Atelier Exemple\nPrestation : Entretien annuel du chauffage\nTotal TTC : 120 €').product, 'Entretien annuel du chauffage');
  assert.equal(parse('Atelier Exemple\nDescription\tQté\tTotal TTC\nFilet CargoVA\t1\t29,95 €\npour remorque\nTotal TTC : 29,95 €').product, 'Filet CargoVA pour remorque');
});

test('Sous-totaux et colonne vide ne remplacent pas un total ou une date absent', () => {
  const p = parse('Atelier Exemple\nTotal produits HT : 12,42 €\nDate de facture\tDate de livraison\nNon indiquée\t28/10/2026');
  assert.equal(p.price, null);
  assert.equal(p.invoiceDate, '');
  assert.equal(p.deliveryDate, '2026-10-28');
  const empty = parse('Atelier Exemple\nDate de facture\tDate de livraison\n\t28/10/2026');
  assert.equal(empty.invoiceDate, '');
  assert.equal(empty.deliveryDate, '2026-10-28');
});

test('Livraison gratuite, remise et paiement séparé restent explicites', () => {
  const p = parse('Atelier Exemple\nTotal TTC : 100 €\nFrais de livraison : 0 €\nRemise : 10,00 €\nMode de paiement\nCarte bancaire\nTransporteur : DHL');
  assert.equal(p.shippingTTC, 0);
  assert.equal(p.discountTTC, 10);
  assert.equal(p.paymentMethod, 'Carte bancaire');
  assert.equal(p.carrier, 'DHL');
});

test('Dates impossibles et nombres ambigus sont rejetés', () => {
  assert.equal(isoDate('31/02/2026'), '');
  assert.equal(isoDate('2026-10-24'), '2026-10-24');
  assert.equal(isoDate('29 février 2024'), '2024-02-29');
  assert.equal(amount('1\u202f234,56 €'), 1234.56);
  assert.equal(amount('TVA FR123456'), null);
  assert.equal(amount('12,42 19,90'), null);
});
