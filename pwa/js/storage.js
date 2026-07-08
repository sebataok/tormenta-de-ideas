// storage.js — IndexedDB local + sync bidireccional con Supabase.
// Estrategia offline-first:
//   * Toda escritura pasa primero por IndexedDB.
//   * Cada operación (upsert idea, upsert avance) se encola en la tabla `outbox`.
//   * Un intervalo periódico intenta enviar la cola cuando hay red.

const DB_NAME = 'tormenta';
const DB_VERSION = 1;

/** @returns {Promise<IDBDatabase>} */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('ideas')) {
        const s = db.createObjectStore('ideas', { keyPath: 'id' });
        s.createIndex('by_created', 'created_at');
      }
      if (!db.objectStoreNames.contains('advances')) {
        const s = db.createObjectStore('advances', { keyPath: 'id' });
        s.createIndex('by_idea', 'idea_id');
      }
      if (!db.objectStoreNames.contains('episodes')) {
        const s = db.createObjectStore('episodes', { keyPath: 'id' });
        s.createIndex('by_idea', 'idea_id');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function tx(db, stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}
function req2p(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const Storage = {
  db: null,

  async init() {
    this.db = await openDB();
    return this;
  },

  // ---------- LECTURA ----------
  async listIdeas() {
    const t = tx(this.db, ['ideas']);
    return await req2p(t.objectStore('ideas').getAll());
  },
  async listAdvances(ideaId) {
    const t = tx(this.db, ['advances']);
    const idx = t.objectStore('advances').index('by_idea');
    return await req2p(idx.getAll(IDBKeyRange.only(ideaId)));
  },
  async listEpisodes(ideaId) {
    const t = tx(this.db, ['episodes']);
    const idx = t.objectStore('episodes').index('by_idea');
    return await req2p(idx.getAll(IDBKeyRange.only(ideaId)));
  },
  async getIdea(id) {
    const t = tx(this.db, ['ideas']);
    return await req2p(t.objectStore('ideas').get(id));
  },

  // ---------- ESCRITURA + OUTBOX ----------
  async saveIdea({ text }) {
    const now = new Date().toISOString();
    const idea = {
      id: uuid(),
      title: this._deriveTitle(text),
      text,
      created_at: now,
      updated_at: now,
      priority: 0,
      status: 'pending_research'
    };
    const t = tx(this.db, ['ideas', 'outbox'], 'readwrite');
    t.objectStore('ideas').put(idea);
    t.objectStore('outbox').add({ op: 'upsert_idea', payload: idea, ts: now });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    return idea;
  },

  async addAdvance(ideaId, { text }) {
    const now = new Date().toISOString();
    const advance = {
      id: uuid(), idea_id: ideaId, text, created_at: now
    };
    const t = tx(this.db, ['ideas', 'advances', 'outbox'], 'readwrite');
    // aumenta priority en la idea
    const ideaReq = t.objectStore('ideas').get(ideaId);
    ideaReq.onsuccess = () => {
      const idea = ideaReq.result;
      if (idea) {
        idea.priority = (idea.priority || 0) + 1;
        idea.updated_at = now;
        idea.status = 'pending_deepdive';
        t.objectStore('ideas').put(idea);
        t.objectStore('outbox').add({ op: 'upsert_idea', payload: idea, ts: now });
      }
    };
    t.objectStore('advances').put(advance);
    t.objectStore('outbox').add({ op: 'upsert_advance', payload: advance, ts: now });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    return advance;
  },

  _deriveTitle(text) {
    const clean = (text || '').trim().replace(/\s+/g, ' ');
    if (clean.length <= 60) return clean || '(sin título)';
    return clean.slice(0, 57) + '...';
  },

  async deleteIdea(ideaId) {
    // 1) Borrar local (ideas + advances + episodes de esa idea)
    const t = tx(this.db, ['ideas', 'advances', 'episodes', 'outbox'], 'readwrite');
    t.objectStore('ideas').delete(ideaId);
    // Advances de esa idea
    const advIdx = t.objectStore('advances').index('by_idea');
    const advReq = advIdx.getAllKeys(IDBKeyRange.only(ideaId));
    advReq.onsuccess = () => (advReq.result || []).forEach(k => t.objectStore('advances').delete(k));
    // Episodes de esa idea
    const epIdx = t.objectStore('episodes').index('by_idea');
    const epReq = epIdx.getAllKeys(IDBKeyRange.only(ideaId));
    epReq.onsuccess = () => (epReq.result || []).forEach(k => t.objectStore('episodes').delete(k));
    // Encolar delete en outbox para propagar al server
    t.objectStore('outbox').add({ op: 'delete_idea', payload: { id: ideaId }, ts: new Date().toISOString() });
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    // Sync inmediato si hay red
    this.syncNow().catch(() => {});
  },

  // ---------- SYNC ----------
  async _flushOutbox() {
    const cfg = window.TORMENTA_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) return { skipped: true };

    const t = tx(this.db, ['outbox']);
    const items = await req2p(t.objectStore('outbox').getAll());
    if (!items.length) return { flushed: 0 };

    const headers = {
      'Content-Type': 'application/json',
      'apikey': cfg.SUPABASE_ANON,
      'Authorization': `Bearer ${cfg.SUPABASE_ANON}`,
      'Prefer': 'resolution=merge-duplicates'
    };
    let ok = 0;

    for (const item of items) {
      let url = null, method = 'POST', body = null;
      if (item.op === 'upsert_idea') {
        url = `${cfg.SUPABASE_URL}/rest/v1/ideas`;
        body = JSON.stringify(item.payload);
      } else if (item.op === 'upsert_advance') {
        url = `${cfg.SUPABASE_URL}/rest/v1/advances`;
        body = JSON.stringify(item.payload);
      } else if (item.op === 'delete_idea') {
        // FK con ON DELETE CASCADE limpia advances/episodes en el server.
        url = `${cfg.SUPABASE_URL}/rest/v1/ideas?id=eq.${encodeURIComponent(item.payload.id)}`;
        method = 'DELETE';
      }
      if (!url) { await this._removeOutbox(item.id); continue; }
      try {
        const opts = { method, headers };
        if (body) opts.body = body;
        const r = await fetch(url, opts);
        if (r.ok || r.status === 409 || r.status === 204) {
          await this._removeOutbox(item.id);
          ok++;
        } else {
          console.warn('sync fail', item.op, r.status);
          break;
        }
      } catch (e) {
        console.warn('sync net error', e);
        break;
      }
    }
    return { flushed: ok, remaining: items.length - ok };
  },
  async _removeOutbox(id) {
    const t = tx(this.db, ['outbox'], 'readwrite');
    t.objectStore('outbox').delete(id);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  },

  async pullFromSupabase() {
    const cfg = window.TORMENTA_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) return { skipped: true };
    const headers = { 'apikey': cfg.SUPABASE_ANON, 'Authorization': `Bearer ${cfg.SUPABASE_ANON}` };

    // ideas
    try {
      const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/ideas?select=*&order=updated_at.desc`, { headers });
      if (r.ok) {
        const rows = await r.json();
        const t = tx(this.db, ['ideas'], 'readwrite');
        rows.forEach(row => t.objectStore('ideas').put(row));
      }
    } catch (e) { console.warn('pull ideas', e); }

    // advances
    try {
      const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/advances?select=*`, { headers });
      if (r.ok) {
        const rows = await r.json();
        const t = tx(this.db, ['advances'], 'readwrite');
        rows.forEach(row => t.objectStore('advances').put(row));
      }
    } catch (e) { console.warn('pull advances', e); }

    // episodes
    try {
      const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/episodes?select=*&order=created_at.desc`, { headers });
      if (r.ok) {
        const rows = await r.json();
        const t = tx(this.db, ['episodes'], 'readwrite');
        rows.forEach(row => t.objectStore('episodes').put(row));
      }
    } catch (e) { console.warn('pull episodes', e); }

    return { ok: true };
  },

  async syncNow() {
    const outRes = await this._flushOutbox();
    await this.pullFromSupabase();
    return outRes;
  },

  startAutoSync(intervalMs = 30000, onStatus = () => {}) {
    const tick = async () => {
      try {
        onStatus('pending');
        const r = await this.syncNow();
        if (r?.skipped) { onStatus('idle'); return; }
        onStatus(r?.remaining ? 'pending' : 'ok');
      } catch (e) {
        onStatus('err');
      }
    };
    tick();
    window.addEventListener('online', tick);
    return setInterval(tick, intervalMs);
  }
};
