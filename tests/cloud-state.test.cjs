const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { join } = require('node:path');

test('La sauvegarde cloud conserve achats anciens, garanties et dossiers sans conversion', async () => {
  const state = {
    purchases: [
      { id: 'old', merchant: 'Amazon', product: 'Filet', purchaseDate: '2026-10-24', price: 29.95,
        commercialWarrantyMonths: 24, sellerType: 'professional' },
      { id: 'new', merchant: 'Test', purchaseDate: '', price: 0,
        extra: { commercialWarrantyEnd: '2027-12-17', fieldConfidence: { product: 60 } } }
    ],
    cases: [
      { id: 'return', type: 'return', status: 'En cours', amount: 29.95 },
      { id: 'refund', type: 'refund', status: 'Terminé', amount: 10 }
    ], recovered: 10
  };
  let saved;
  const window = {
    supabase: { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'test-user' } } }) },
      from: table => {
        assert.equal(table, 'recover_states');
        return {
          upsert: async (payload, options) => {
            assert.equal(options.onConflict, 'user_id');
            saved = payload;
            return {};
          },
          select: () => ({
            eq: (column, user) => {
              assert.equal(column, 'user_id');
              assert.equal(user, 'test-user');
              return { maybeSingle: async () => ({ data: { data: saved.data } }) };
            }
          })
        };
      }
    }) }
  };
  runInNewContext(readFileSync(join(__dirname, '../cloud.js'), 'utf8'), {
    window, localStorage: { getItem: () => '{}' },
    document: { readyState: 'loading', addEventListener() {} }
  });
  await window.RecoverCloud.saveState(state);
  assert.equal(saved.user_id, 'test-user');
  assert.deepEqual(await window.RecoverCloud.loadState(), state);
});
