import { validateData } from './model.js';
import { mergeSync, syncedData } from './sync-model.js';

export function createStore(repository, initial) {
  let state = {
    ...initial,
    ui: {
      query: '', status: 'active', sort: 'created', direction: 'desc', view: 'list', tagIds: [], limit: 100,
      editing: null, panelWidth: 460, panelClosing: false, confirmation: null, helpOpen: false,
      tagsOpen: false, tagEdit: null, tagFormKey: 'new', tagQuery: '', tagSearchOpen: false,
      pendingStatuses: {}, editStatus: 'Saved', editError: '',
    },
    saving: false, error: '',
  };
  let queue = Promise.resolve();
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(repository.channelName) : null;
  function publish(patch) { state = { ...state, ...patch }; for (const listener of listeners) listener(state); }
  function enqueue(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
  async function reload() { const fresh = await repository.load(); validateData(fresh.data); publish(fresh); }
  async function persist(next, blobs = [], replace = false, sync = null) {
    validateData(next);
    publish({ saving: true, error: '' });
    try {
      const revision = await repository.commit(state.data, next, state.revision, blobs, replace, sync);
      publish({ data: next, revision, saving: false }); channel?.postMessage(revision);
    } catch (error) {
      try { await reload(); } catch { /* Retain the last committed snapshot if storage cannot be read. */ }
      publish({ saving: false, error: error.message }); throw error;
    }
  }
  if (channel) channel.onmessage = ({ data }) => { if (data > state.revision) enqueue(reload).catch(error => publish({ error: error.message })); };
  return {
    getState: () => state,
    error: message => publish({ error: message }),
    ui: patch => publish({ ui: { ...state.ui, ...patch } }),
    mutate: change => enqueue(async () => { const next = structuredClone(state.data); const blobs = change(next) || []; await persist(next, blobs); }),
    replace: (data, blobs) => enqueue(() => persist(structuredClone(data), blobs, true)),
    mergeCloud: (remote, blobs) => enqueue(async () => {
      const current = await repository.load();
      if (current.revision !== state.revision) { validateData(current.data); publish(current); }
      const sync = mergeSync(current.sync, remote);
      if (JSON.stringify(sync) !== JSON.stringify(current.sync)) await persist(syncedData(sync), blobs, false, sync);
    }),
    whenIdle: () => queue,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { channel?.close(); listeners.clear(); },
  };
}
