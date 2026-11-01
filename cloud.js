(() => {
  const CONFIG_KEY = 'recover_cloud_config_v1';
  const BUCKET = 'recover-documents';
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

  window.RecoverCloud = {
    getConfig, setConfig, clearConfig, init, isConfigured, isReady,
    signUp, signIn, signOut, getSession, getUser,
    loadState, saveState, uploadDocument, getDocumentUrl, deleteDocument, testConnection,
    bucket: BUCKET
  };
})();
