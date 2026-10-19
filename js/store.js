/* BurnLog — storage layer.
 * All reads/writes go through BLStore, which talks to a pluggable *adapter*. Today the adapter is
 * LocalStorageAdapter. To add a shared backend later, implement the same 3 async methods
 * (read/write/remove) against an API, or implement `sync(changes)` and call BLStore.setAdapter().
 * Records carry id / createdAt / updatedAt / deletedAt (soft-delete tombstones) / deviceId so they can be
 * merged last-write-wins with a server without schema changes.
 */
(function (root) {
  'use strict';
  const PREFIX = 'burnlog.v1.';
  const SCHEMA = 1;

  const LocalStorageAdapter = {
    name: 'localStorage',
    async read(key) { try { const v = localStorage.getItem(PREFIX + key); return v ? JSON.parse(v) : null; } catch (e) { console.warn('read fail', key, e); return null; } },
    async write(key, value) { localStorage.setItem(PREFIX + key, JSON.stringify(value)); },
    async remove(key) { localStorage.removeItem(PREFIX + key); },
    async keys() { return Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length)); },
  };

  // Example shape for a future backend (not used):
  // const RemoteAdapter = { name:'remote', read:k=>fetch(`/api/${k}`).then(r=>r.json()), write:(k,v)=>fetch(`/api/${k}`,{method:'PUT',body:JSON.stringify(v)}), remove:... };

  const DEFAULT_SETTINGS = { distUnit: 'mi', weightUnit: 'lb', formula: 'gross', weekStart: 1,
    chart: { view: 'calories', range: '30d', group: 'day', type: { calories: 'bar', category: 'doughnut', distance: 'bar', pace: 'line' } } };

  function uid() {
    if (root.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  const nowIso = () => new Date().toISOString();

  const state = { meta: null, profile: null, settings: null, entries: [] };
  const listeners = new Set();
  let adapter = LocalStorageAdapter;

  function emit(what) { listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); }
  async function persist(key) { await adapter.write(key, state[key]); }

  const BLStore = {
    SCHEMA, uid,
    get adapterName() { return adapter.name; },
    async init() {
      state.meta = (await adapter.read('meta')) || { schema: SCHEMA, deviceId: uid(), createdAt: nowIso() };
      state.profile = await adapter.read('profile');
      const s = (await adapter.read('settings')) || {};
      state.settings = Object.assign({}, DEFAULT_SETTINGS, s, { chart: Object.assign({}, DEFAULT_SETTINGS.chart, s.chart || {},
        { type: Object.assign({}, DEFAULT_SETTINGS.chart.type, (s.chart || {}).type || {}) }) });
      state.entries = (await adapter.read('entries')) || [];
      await persist('meta');
      return this;
    },
    setAdapter(a) { adapter = a; return this.init(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    getProfile() { return state.profile; },
    async saveProfile(p) { state.profile = Object.assign({}, state.profile || { createdAt: nowIso() }, p, { updatedAt: nowIso() }); await persist('profile'); emit('profile'); return state.profile; },
    getSettings() { return state.settings; },
    async saveSettings(patch) { state.settings = Object.assign({}, state.settings, patch); await persist('settings'); emit('settings'); return state.settings; },

    listEntries(opts) {
      opts = opts || {};
      return state.entries.filter(e => opts.includeDeleted || !e.deletedAt);
    },
    getEntry(id) { return state.entries.find(e => e.id === id && !e.deletedAt) || null; },
    async addEntry(e) {
      const rec = Object.assign({ id: uid(), createdAt: nowIso(), deviceId: state.meta.deviceId, source: 'manual' }, e, { updatedAt: nowIso() });
      state.entries.push(rec); await persist('entries'); emit('entries'); return rec;
    },
    async addEntries(list) {
      const out = list.map(e => Object.assign({ id: uid(), createdAt: nowIso(), deviceId: state.meta.deviceId, source: 'manual' }, e, { updatedAt: nowIso() }));
      state.entries.push(...out); await persist('entries'); emit('entries'); return out;
    },
    async updateEntry(id, patch) {
      const i = state.entries.findIndex(e => e.id === id); if (i < 0) return null;
      state.entries[i] = Object.assign({}, state.entries[i], patch, { updatedAt: nowIso() });
      await persist('entries'); emit('entries'); return state.entries[i];
    },
    async deleteEntry(id) { return this.updateEntry(id, { deletedAt: nowIso() }); },  // tombstone for future sync
    async purgeWhere(fn) { state.entries = state.entries.filter(e => !fn(e)); await persist('entries'); emit('entries'); },
    async clearAll() {
      for (const k of ['profile', 'settings', 'entries', 'meta']) await adapter.remove(k);
      state.profile = null; state.entries = []; await this.init(); emit('all');
    },
    exportAll() {
      return { app: 'BurnLog', schema: SCHEMA, exportedAt: nowIso(), deviceId: state.meta.deviceId,
        profile: state.profile, settings: state.settings, entries: state.entries };
    },
    async importAll(data, mode) {
      if (!data || data.app !== 'BurnLog' || !Array.isArray(data.entries)) throw new Error('Not a BurnLog export file');
      if (mode === 'replace') state.entries = data.entries.slice();
      else {  // merge, last-write-wins by updatedAt
        const map = new Map(state.entries.map(e => [e.id, e]));
        data.entries.forEach(e => { const cur = map.get(e.id); if (!cur || (e.updatedAt || '') > (cur.updatedAt || '')) map.set(e.id, e); });
        state.entries = [...map.values()];
      }
      if (data.profile && (mode === 'replace' || !state.profile)) state.profile = data.profile;
      if (data.settings && mode === 'replace') state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      await persist('entries'); await persist('profile'); await persist('settings'); emit('all');
      return state.entries.length;
    },
  };
  root.BLStore = BLStore;
})(window);
