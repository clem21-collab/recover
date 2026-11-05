(() => {
  const CONFIG_KEY = 'recover_cloud_config_v1';
  const BUCKET = 'recover-documents';
  const AI_FUNCTION = 'recover-visual-ai';
  const AI_CONSENT_KEY = 'recover_visual_ai_consent_v1';
  let client = null;

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); }
    catch { return null; }
  }

  function normalizeUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function setConfig(url, key) {
    const cfg = { url: normalizeUrl(url), key: String(key || '').trim() };
    if (!/^https:\/\/.+\.supabase\.co$/i.test(cfg.url)) throw new Error('URL Supabase invalide.');
    if (cfg.key.length < 20) throw new Error('Clé publishable / anon invalide.');
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    client = null;
    init();
    return cfg;
  }

  function clearConfig() {
    localStorage.removeItem(CONFIG_KEY);
    client = null;
  }

  function init() {
    if (client) return client;
    const cfg = getConfig();
    if (!cfg || !window.supabase?.createClient) return null;
    client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return client;
  }

  function isConfigured() { return !!getConfig(); }
  function isReady() { return !!init(); }

  async function signUp(name, email, password) {
    const c = init();
    if (!c) throw new Error('Cloud non configuré.');
    const { data, error } = await c.auth.signUp({
      email,
      password,
      options: { data: { display_name: name || '' } }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const c = init();
    if (!c) throw new Error('Cloud non configuré.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const c = init();
    if (!c) return;
    const { error } = await c.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const c = init();
    if (!c) return null;
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getUser() {
    const c = init();
    if (!c) return null;
    const { data, error } = await c.auth.getUser();
    if (error) throw error;
    return data.user || null;
  }

  async function loadState() {
    const c = init();
    const user = await getUser();
    if (!c || !user) return null;
    const { data, error } = await c.from('recover_states').select('data, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data?.data || null;
  }

  async function saveState(state) {
    const c = init();
    const user = await getUser();
    if (!c || !user) throw new Error('Session cloud absente.');
    const payload = { user_id: user.id, data: state, updated_at: new Date().toISOString() };
    const { error } = await c.from('recover_states').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
    return true;
  }

  function safeName(name) {
    return String(name || 'document')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .slice(-120);
  }

  async function uploadDocument(file) {
    if (!file) return null;
    const c = init();
    const user = await getUser();
    if (!c || !user) throw new Error('Session cloud absente.');
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName(file.name)}`;
    const { data, error } = await c.storage.from(BUCKET).upload(path, file, {
      cacheControl: '300',
      contentType: file.type || undefined,
      upsert: false
    });
    if (error) throw error;
    return data.path;
  }

  async function getDocumentUrl(path, expiresIn = 300) {
    if (!path) return null;
    const c = init();
    if (!c) throw new Error('Cloud non configuré.');
    const { data, error } = await c.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }

  async function deleteDocument(path) {
    if (!path) return;
    const c = init();
    if (!c) return;
    const { error } = await c.storage.from(BUCKET).remove([path]);
    if (error) throw error;
  }

  async function testConnection() {
    const c = init();
    if (!c) throw new Error('Cloud non configuré.');
    const { error } = await c.auth.getSession();
    if (error) throw error;
    return true;
  }

  async function visualAnalyze(payload) {
    const c = init();
    if (!c) throw new Error('Cloud non configuré.');
    const session = await getSession();
    if (!session) throw new Error('Connectez-vous avant d’utiliser l’IA visuelle.');
    const { data, error } = await c.functions.invoke(AI_FUNCTION, { body: payload });
    if (error) throw error;
    if (!data?.analysis) throw new Error(data?.error || 'Réponse IA visuelle invalide.');
    return data;
  }

  function aiConsentGranted() {
    return localStorage.getItem(AI_CONSENT_KEY) === 'yes';
  }

  function requestAiConsent() {
    if (aiConsentGranted()) return true;
    const ok = window.confirm(
      'Recover va envoyer une copie réduite des premières pages de cette facture, ainsi que le texte extrait, à l’IA via notre serveur Supabase. Le document peut contenir des données personnelles. Continuer ?'
    );
    if (ok) localStorage.setItem(AI_CONSENT_KEY, 'yes');
    return ok;
  }

  function clearAiConsent() {
    localStorage.removeItem(AI_CONSENT_KEY);
  }

  window.RecoverCloud = {
    getConfig, setConfig, clearConfig, init, isConfigured, isReady,
    signUp, signIn, signOut, getSession, getUser,
    loadState, saveState, uploadDocument, getDocumentUrl, deleteDocument, testConnection,
    visualAnalyze, aiConsentGranted, requestAiConsent, clearAiConsent,
    bucket: BUCKET,
    aiFunction: AI_FUNCTION
  };

  // ---- IA visuelle de secours pour app.html ----
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function fieldMissing(v) {
    return v === null || v === undefined || v === '' || v === 'Non détecté' || v === 'Non détectée';
  }

  function suspiciousProduct(v) {
    const s = String(v || '').toLowerCase();
    return !s || /conditions? (générales? )?de vente|mentions? légales?|informatique et libertés|adresse de facturation|adresse de livraison|service client|merci de votre visite|facture total/.test(s);
  }

  function needsVisualFallback(p, text = '') {
    if (!p) return false;
    const c = p.confidence || {};
    if ((c.merchant || 0) < 72 || (c.product || 0) < 72 || (c.price || 0) < 80 || (c.date || 0) < 70) return true;
    if (suspiciousProduct(p.product)) return true;
    if (p.documentType === 'Facture' && (fieldMissing(p.invoiceNumber) || fieldMissing(p.invoiceDate))) return true;
    if (fieldMissing(p.price) || fieldMissing(p.merchant)) return true;
    const n = String(text || '').toLowerCase();
    if (n.includes('tva') && (fieldMissing(p.vatRate) || fieldMissing(p.vatAmount))) return true;
    return false;
  }

  async function canvasDataUrl(canvas, quality = 0.82) {
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function imageFileToDataUrl(file) {
    const raw = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = raw;
    });
    const max = 1800;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasDataUrl(canvas);
  }

  async function previewImages(file) {
    if (!file) return [];
    if ((file.type || '').startsWith('image/')) return [await imageFileToDataUrl(file)];
    if (file.type !== 'application/pdf' || !window.pdfjsLib) return [];
    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.55 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push(await canvasDataUrl(canvas, 0.8));
    }
    return pages;
  }

  function manualOverrides() {
    const val = id => document.querySelector(id)?.value || '';
    return {
      merchant: val('#merchant'),
      product: val('#product'),
      price: val('#price') ? Number(val('#price')) : null,
      purchaseDate: val('#purchase-date'),
      orderNumber: val('#order-number'),
      deliveryDate: val('#delivery-date')
    };
  }

  function applyManual(p) {
    const m = manualOverrides();
    for (const [k, v] of Object.entries(m)) {
      if (v !== '' && v !== null && v !== undefined) p[k] = v;
    }
    return p;
  }

  function formatDateFr(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  }

  function cleanGenericFields(fields) {
    const noisy = /^(?:total|tva|ht|ttc|date|n[°o]?\s*(?:facture|client|commande|contrat)|siret|asin|référence\s*paiement|vendu\s*par|marchand|produit|catégorie|type\s*de\s*document)$/i;
    return (Array.isArray(fields) ? fields : [])
      .filter(x => x?.label && x?.value)
      .filter(x => !noisy.test(String(x.label).trim()))
      .filter((x, i, a) => a.findIndex(y => y.label === x.label && y.value === x.value) === i)
      .slice(0, 12);
  }

  function mergeAi(local, ai) {
    const out = JSON.parse(JSON.stringify(local || {}));
    const conf = ai?.confidence || {};
    const localConf = out.confidence || {};
    const keyMap = {
      merchant: 'merchant', product: 'product', price: 'price', purchaseDate: 'purchaseDate',
      orderNumber: 'orderNumber', invoiceDate: 'invoiceDate', deliveryDate: 'deliveryDate',
      shippingDate: 'shippingDate', dueDate: 'dueDate', invoiceNumber: 'invoiceNumber',
      clientNumber: 'clientNumber', contractNumber: 'contractNumber', ht: 'ht',
      vatRate: 'vatRate', vatAmount: 'vatAmount', vatNumber: 'vatNumber', seller: 'seller',
      paymentReference: 'paymentReference', asin: 'asin', siret: 'siret', category: 'category',
      documentType: 'documentType'
    };

    for (const [src, dst] of Object.entries(keyMap)) {
      const value = ai?.[src];
      if (value === null || value === undefined || value === '') continue;
      const ac = Number(conf[src] || 0);
      let should = fieldMissing(out[dst]);
      if (src === 'product' && suspiciousProduct(out.product)) should = true;
      if (src === 'category' || src === 'documentType') should = ac >= 75;
      if (['merchant','product','price','purchaseDate','orderNumber'].includes(src)) {
        const lc = Number(localConf[src === 'price' ? 'price' : src === 'purchaseDate' ? 'date' : src === 'orderNumber' ? 'order' : src] || 0);
        if (ac >= 88 && ac >= lc - 5) should = true;
      } else if (ac >= 82) {
        should = true;
      }
      if (should) out[dst] = value;
    }

    // Les montants détaillés proviennent de champs structurés distincts : ne jamais
    // supposer que « Total produits HT » est le total HT global de la facture.
    const detailAmounts = ['itemsSubtotalHT', 'itemsSubtotalTTC', 'shippingTTC', 'discountTTC'];
    for (const key of detailAmounts) {
      if (!Object.prototype.hasOwnProperty.call(ai || {}, key)) continue;
      const value = ai[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    for (const key of ['paymentMethod', 'carrier', 'billingPeriod']) {
      const value = ai?.[key];
      if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 180);
    }
    if (Array.isArray(ai?.lineItems)) {
      out.lineItems = ai.lineItems.slice(0, 12).filter(item =>
        item && typeof item.description === 'string' && item.description.trim()
      ).map(item => ({
        description: item.description.trim().slice(0, 240),
        quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : null,
        totalTTC: Number.isFinite(item.totalTTC) && item.totalTTC >= 0 ? item.totalTTC : null
      }));
    }
    // Si l'IA indique explicitement un sous-total produits HT, sans HT global,
    // on retire l'ancien HT hérité de l'OCR lorsque des frais de port sont séparés.
    if (ai?.ht === null && out.shippingTTC > 0 &&
        typeof out.itemsSubtotalHT === 'number' &&
        Math.abs(Number(out.ht) - out.itemsSubtotalHT) < 0.02) {
      out.ht = null;
    }

    // La date principale de Recover utilise purchaseDate. Sur une facture magasin,
    // la date de facture est le meilleur repli lorsqu'aucune date de commande/achat n'existe.
    if (fieldMissing(out.purchaseDate) && !fieldMissing(out.invoiceDate)) {
      out.purchaseDate = out.invoiceDate;
    }

    // Quand le document ne distingue pas explicitement marchand et vendeur,
    // le marchand confirmé par l'IA est un repli sûr pour « Vendu par ».
    // Une place de marché n'est pas nécessairement le vendeur du produit.
    // Ne jamais renseigner « Vendu par Amazon » si aucun vendeur explicite n'a été identifié.
    const merchantNormalized = String(out.merchant || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const marketplace = /\b(?:amazon|cdiscount|fnac|rakuten|ebay|aliexpress|etsy|manomano|back market|vinted|la redoute)\b/.test(merchantNormalized);
    if (fieldMissing(out.seller) && !fieldMissing(out.merchant) && !marketplace) {
      out.seller = out.merchant;
    }

    out.confidence = { ...localConf };
    if (conf.merchant) out.confidence.merchant = Math.max(out.confidence.merchant || 0, conf.merchant);
    if (conf.product) out.confidence.product = Math.max(out.confidence.product || 0, conf.product);
    if (conf.price) out.confidence.price = Math.max(out.confidence.price || 0, conf.price);
    if (conf.purchaseDate || conf.invoiceDate) out.confidence.date = Math.max(out.confidence.date || 0, conf.purchaseDate || conf.invoiceDate || 0);
    if (conf.orderNumber) out.confidence.order = Math.max(out.confidence.order || 0, conf.orderNumber);
    if (fieldMissing(ai?.seller) && conf.merchant) out.confidence.seller = Math.max(out.confidence.seller || 0, conf.merchant);

    out.enhanced = true;
    out.aiUsed = true;
    out.aiModel = ai?.model || '';
    out.aiEvidence = ai?.evidence || {};
    out.enhancedNotes = ['Vérification par IA visuelle'];

    // Après une analyse IA structurée, on évite de réafficher les paires OCR brutes
    // qui mélangeaient colonnes, adresses et fragments. On conserve seulement des extras utiles.
    const extras = [];
    if (ai?.commercialWarrantyEnd) extras.push({ label: 'Garantie commerciale jusqu’au', value: formatDateFr(ai.commercialWarrantyEnd) });
    if (ai?.legalWarrantyText) extras.push({ label: 'Garantie légale détectée', value: ai.legalWarrantyText });
    out.genericFields = cleanGenericFields(extras);

    return applyManual(out);
  }

  function injectAiBanner(data) {
    const content = document.querySelector('#result-content');
    if (!content || content.querySelector('.recover-ai-visual-banner')) return;
    const box = document.createElement('div');
    box.className = 'enhanced-box recover-ai-visual-banner';
    const model = data?.model ? ` · ${data.model}` : '';
    box.innerHTML = `<strong>✨ IA visuelle utilisée${model}</strong><p>Recover a comparé directement l’image de la facture avec l’analyse locale. Les champs absents du document restent vides au lieu d’être inventés.</p>`;
    content.prepend(box);
  }

  function addManualAiButton() {
    const dlg = document.querySelector('#analysis-result-dialog');
    if (!dlg?.open) return;
    const actions = dlg.querySelector('.modal-actions') || dlg.querySelector('form') || dlg;
    if (dlg.querySelector('#recover-ai-check')) return;
    const btn = document.createElement('button');
    btn.id = 'recover-ai-check';
    btn.type = 'button';
    btn.className = 'btn btn-secondary';
    btn.textContent = '✨ Vérifier avec l’IA visuelle';
    btn.addEventListener('click', () => runVisualAi(true));
    actions.appendChild(btn);
  }

  function resetAiButton(success = false) {
    const button = document.querySelector('#recover-ai-check');
    if (!button) return;
    button.disabled = false;
    button.textContent = success ? '✨ Vérifier à nouveau avec l’IA visuelle' : '✨ Vérifier avec l’IA visuelle';
  }

  let aiBusy = false;
  let doneFingerprint = '';

  function fingerprint(file) {
    return file ? `${file.name}|${file.size}|${file.lastModified}` : '';
  }

  async function runVisualAi(force = false) {
    if (aiBusy) return;
    const file = document.querySelector('#file-input')?.files?.[0];
    if (!file) return;
    const fp = fingerprint(file);
    if (!force && doneFingerprint === fp) return;

    let succeeded = false;
    try {
      const text = typeof window.extractFile === 'function' ? await window.extractFile(file) : '';
      let local = window.RecoverParser?.parse ? window.RecoverParser.parse(text) : {};
      if (typeof window.enhancedParse === 'function') local = window.enhancedParse(local, text).parsed;
      local = applyManual(local);
      if (!force && !needsVisualFallback(local, text)) return;
      if (!requestAiConsent()) return;

      aiBusy = true;
      const button = document.querySelector('#recover-ai-check');
      if (button) { button.disabled = true; button.textContent = '✨ IA visuelle en cours…'; }
      const content = document.querySelector('#result-content');
      if (content && !content.querySelector('#recover-ai-running')) {
        const box = document.createElement('div');
        box.id = 'recover-ai-running';
        box.className = 'enhanced-box';
        box.innerHTML = '<strong>✨ Vérification IA visuelle…</strong><p>Recover relit les premières pages du document et croise les résultats avec l’analyse locale.</p>';
        content.prepend(box);
      }

      const images = await previewImages(file);
      if (!images.length) throw new Error('Impossible de préparer un aperçu visuel du document.');
      const result = await visualAnalyze({
        fileName: file.name,
        mimeType: file.type,
        extractedText: String(text || '').slice(0, 24000),
        localAnalysis: local,
        images
      });
      const merged = mergeAi(local, { ...result.analysis, model: result.model });
      doneFingerprint = fp;
      succeeded = true;

      const dlg = document.querySelector('#analysis-result-dialog');
      if (dlg?.open) dlg.close();
      if (typeof window.showResult === 'function') {
        window.showResult(merged);
        await sleep(0);
        injectAiBanner(result);
        addManualAiButton();
      }
    } catch (err) {
      console.error('Recover IA visuelle:', err);
      doneFingerprint = '';
      const running = document.querySelector('#recover-ai-running');
      if (running) running.innerHTML = `<strong>⚠️ IA visuelle indisponible</strong><p>${String(err?.message || err)}</p>`;
      const button = document.querySelector('#recover-ai-check');
      if (button) { button.disabled = false; button.textContent = '✨ Réessayer avec l’IA visuelle'; }
    } finally {
      aiBusy = false;
      if (succeeded) resetAiButton(true);
    }
  }

  function installVisualAiFallback() {
    const dlg = document.querySelector('#analysis-result-dialog');
    if (!dlg) return;
    const observer = new MutationObserver(() => {
      if (!dlg.open) return;
      addManualAiButton();
      const file = document.querySelector('#file-input')?.files?.[0];
      if (!file || doneFingerprint === fingerprint(file) || aiBusy) return;
      setTimeout(() => runVisualAi(false), 120);
    });
    observer.observe(dlg, { attributes: true, attributeFilter: ['open'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installVisualAiFallback);
  } else {
    installVisualAiFallback();
  }
})();
