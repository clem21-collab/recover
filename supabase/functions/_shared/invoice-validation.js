(function () {
  const dateFields = [
    'purchaseDate',
    'invoiceDate',
    'shippingDate',
    'deliveryDate',
    'dueDate',
    'commercialWarrantyEnd',
  ];
  const amountFields = [
    'price',
    'ht',
    'vatAmount',
    'vatRate',
    'itemsSubtotalHT',
    'itemsSubtotalTTC',
    'shippingTTC',
    'discountTTC',
  ];
  const textFields = [
    'merchant',
    'seller',
    'product',
    'orderNumber',
    'invoiceNumber',
    'clientNumber',
    'contractNumber',
    'vatNumber',
    'paymentReference',
    'asin',
    'siret',
    'paymentMethod',
    'carrier',
    'billingPeriod',
    'legalWarrantyText',
  ];
  const categories = [
    'Achat',
    'Télécom',
    'Énergie',
    'Assurance',
    'Automobile',
    'Hôtel',
    'Transport',
    'Abonnement',
    'Service',
    'Autre',
  ];
  const documents = ['Facture', 'Ticket', 'Commande', 'Relevé', 'Devis', 'Autre'];
  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validText(value) {
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 500 &&
      !/[<>\u0000-\u001f]/.test(value) &&
      !/^(?:null|unknown|non detecte[e]?|non indique[e]?|achat \/ service|prestataire non identifie)$/.test(
        normalize(value),
      )
    );
  }

  function validProduct(value) {
    return (
      validText(value) &&
      value.length >= 4 &&
      /\p{L}/u.test(value) &&
      !/^(?:reference|produit|article|designation|description|commande|facture|quantite|prix|total)$/.test(
        normalize(value),
      ) &&
      !/adresse|mentions legales|conditions generales|service client|siret|https?:|@/.test(normalize(value))
    );
  }

  function validIdentifier(value) {
    return (
      validText(value) &&
      /^#?[\p{L}\d][\p{L}\d./_-]{1,59}$/u.test(value) &&
      !/^(?:commande|facture|reference|client|contrat|numero)$/.test(normalize(value)) &&
      !/^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(value) &&
      (/\d/.test(value) || /^[A-Z]{5,}$/.test(value))
    );
  }

  function validateAnalysis(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Analyse IA invalide.');
    const out = { confidence: {}, evidence: {}, validationWarnings: [] };
    for (const field of [...dateFields, ...amountFields, ...textFields, 'category', 'documentType']) {
      const value = input[field];
      if (value === null || value === undefined || value === '') continue;
      let valid;
      if (dateFields.includes(field)) valid = validDate(value);
      else if (amountFields.includes(field))
        valid =
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          (field !== 'vatRate' || value <= 100);
      else if (field === 'product') valid = validProduct(value);
      else if (['orderNumber', 'invoiceNumber', 'clientNumber', 'contractNumber'].includes(field))
        valid = validIdentifier(value);
      else if (field === 'category') valid = categories.includes(value);
      else if (field === 'documentType') valid = documents.includes(value);
      else valid = validText(value);
      if (!valid) {
        out.validationWarnings.push(field);
        continue;
      }
      out[field] = typeof value === 'string' ? value.trim() : value;
      const confidence = input.confidence?.[field];
      out.confidence[field] =
        typeof confidence === 'number' && Number.isFinite(confidence)
          ? Math.max(0, Math.min(95, Math.round(confidence)))
          : 0;
    }
    out.lineItems = (Array.isArray(input.lineItems) ? input.lineItems : [])
      .slice(0, 12)
      .filter((item) => item && validProduct(item.description))
      .map((item) => ({
        description: item.description.trim(),
        quantity:
          typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0
            ? item.quantity
            : null,
        totalTTC:
          typeof item.totalTTC === 'number' && Number.isFinite(item.totalTTC) && item.totalTTC >= 0
            ? item.totalTTC
            : null,
      }));
    for (const [key, value] of Object.entries(input.evidence || {})) {
      if (
        textFields.includes(key) ||
        dateFields.includes(key) ||
        ['price', 'vat', 'warranty'].includes(key)
      ) {
        if (validText(value)) out.evidence[key] = value.slice(0, 300);
      }
    }
    if (input.ht === null) out.ht = null;
    if (!Object.keys(out.confidence).length) throw new Error('Gemini n’a renvoyé aucun champ valide.');
    return out;
  }

  function financialWarnings(p) {
    const warnings = [];
    const has = (key) => typeof p[key] === 'number' && Number.isFinite(p[key]);
    if (has('price') && has('ht') && has('vatAmount') && Math.abs(p.ht + p.vatAmount - p.price) > 0.03) {
      warnings.push('Le total HT et la TVA ne correspondent pas au total TTC. Vérifiez les montants.');
    }
    if (
      ['price', 'itemsSubtotalTTC', 'shippingTTC', 'discountTTC'].every(has) &&
      Math.abs(p.itemsSubtotalTTC + p.shippingTTC - p.discountTTC - p.price) > 0.03
    ) {
      warnings.push('Les produits, la livraison et la remise ne correspondent pas au total payé.');
    }
    return warnings;
  }

  globalThis.RecoverInvoiceValidation = {
    validDate,
    validProduct,
    validIdentifier,
    validateAnalysis,
    financialWarnings,
  };
})();
