const { test } = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../parser.js');
const { parse } = window.RecoverParser;

function expectFields(text, expected) {
  const result = parse(text);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result[key], value, key);
  }
}

test('Amazon — dates distinctes et référence de commande', () => {
  expectFields([
    'AMAZON EU S.À R.L.',
    'Facture',
    'Date de la commande : 28 octobre 2026',
    'Numéro de commande : 402-1234567-7654321',
    'Date de facture : 29 octobre 2026',
    'N° facture : FR-12345',
    'Samsung Galaxy Buds3 Pro',
    'Total HT : 83,33 €',
    'Total TTC : 100,00 €'
  ].join('\n'), {
    merchant: 'Amazon', product: 'Samsung Galaxy Buds3 Pro', price: 100, ht: 83.33,
    purchaseDate: '2026-10-28', invoiceDate: '2026-10-29',
    orderNumber: '402-1234567-7654321', invoiceNumber: 'FR-12345'
  });
});

test('Boulanger — champs adjacents et désignation tabulaire', () => {
  expectFields([
    'Boulanger',
    'N° commande\t123456789',
    'N° facture\tBL-12345',
    'Date de facture\t21/10/2026',
    'Référence\tDésignation\tQté\tTotal TTC',
    '123456\tLave-linge 8 kg\t1\t349,99 €',
    'Total TTC : 349,99 €'
  ].join('\n'), {
    merchant: 'Boulanger', product: 'Lave-linge 8 kg', price: 349.99,
    purchaseDate: '2026-10-21', orderNumber: '123456789', invoiceNumber: 'BL-12345'
  });
});

test('Promovap — colonnes du PDF, facture et ventilation des montants', () => {
  expectFields([
    'Promovap',
    '18/01/2024',
    '#FA027121',
    'Numéro de commande :\tDate de commande :\tMoyen de paiement :\tTransporteur',
    'XFFUEXICS\t18/01/2024\te-Transactions\tColissimo Domicile sans',
    'signature / Lettre suivie',
    'Adresse de livraison\tAdresse de facturation',
    '1 rue Exemple\t2 rue Exemple',
    'Produit / Référence\tPrix unitaire (HT)\tPrix unitaire (TTC)\tQté\tTotal (TTC)',
    'Fraise Rhubarbe 50ml DEVIL SQUIZ\t12,42 €\t14,90 €\t1\t14,90 €',
    'Total Produits HT : 12,42 €',
    'Total Produits TTC : 14,90 €',
    "Frais d'expédition :\t5,00 €",
    'Total Taxes :\t2,48 €',
    'Total : 19,90 €',
    'Devise : EUR'
  ].join('\n'), {
    merchant: 'Promovap', product: 'Fraise Rhubarbe 50ml DEVIL SQUIZ',
    purchaseDate: '2024-01-18', invoiceDate: '2024-01-18',
    orderNumber: 'XFFUEXICS', invoiceNumber: '#FA027121',
    price: 19.9, itemsSubtotalHT: 12.42, itemsSubtotalTTC: 14.9,
    shippingTTC: 5, vatAmount: 2.48, vatRate: null, ht: null,
    paymentMethod: 'e-Transactions', genericFields: [{ label: 'Devise', value: 'EUR' }]
  });
});

test('Champs manquants — les libellés et la date voisine ne deviennent pas des références', () => {
  expectFields('Promovap\nN° commande :\tDate de commande :\nCOMMANDE\t18/01/2024', {
    orderNumber: '', purchaseDate: '2024-01-18', invoiceNumber: ''
  });
});
