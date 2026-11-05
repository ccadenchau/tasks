import { mergeSync, syncedData, validateSync } from './sync-model.js';

export function startCloudSync(store, repository, { api, interval = 30000, delay = 700 }) {
  let timer, running = false, requested = false, stopped = false, uploaded = '', revision = store.getState().revision;
  const uploadedFiles = new Set();
  const status = (kind, title) => store.ui({ syncStatus: { kind, title } });

  async function synchronize() {
    await store.whenIdle();
    let current = await repository.load(), merged = current.sync;
    const keys = await api.keys();
    for (const key of keys.filter(key => key.startsWith('checklist_'))) {
      const remote = validateSync(await api.read(key));
      merged = mergeSync(merged, remote);
      if (key === `checklist_${current.sync.replica}`) uploaded = JSON.stringify(remote);
    }
    const data = syncedData(merged), blobs = [];
    for (const file of data.attachments) {
      if (!await repository.getBlob(file.id)) blobs.push({ id: file.id, blob: await api.downloadFile(file) });
    }
    await store.mergeCloud(merged, blobs);
    current = await repository.load();
    const payload = JSON.stringify(current.sync);
    if (payload !== uploaded) {
      for (const file of current.data.attachments) {
        if (uploadedFiles.has(file.id)) continue;
        await api.uploadFile(file, await repository.getBlob(file.id)); uploadedFiles.add(file.id);
      }
      await api.write(`checklist_${current.sync.replica}`, current.sync);
      uploaded = payload;
    }
    status('synced', 'Synced with api.cadenchau.com. Click to sync now.');
  }

  async function run() {
    if (stopped || running) return;
    running = true; requested = false;
    status('syncing', 'Syncing with api.cadenchau.com');
    try {
      if (globalThis.navigator?.locks) await navigator.locks.request('checklist-cloud-sync', synchronize);
      else await synchronize();
    } catch (error) {
      status('error', `${error.message || 'Cloud sync unavailable.'} Changes remain saved on this device. Click to retry.`);
    } finally {
      running = false;
      if (requested && !stopped) schedule();
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(run, delay); }
  function request() {
    if (stopped) return;
    requested = true;
    if (!running) { clearTimeout(timer); void run(); }
  }
  const unsubscribe = store.subscribe(state => {
    if (state.revision === revision) return;
    revision = state.revision; requested = true;
    if (!running) { status('pending', 'Changes saved on this device; cloud sync pending.'); schedule(); }
  });
  const online = () => request();
  const visible = () => { if (document.visibilityState === 'visible') request(); };
  globalThis.window?.addEventListener('online', online);
  globalThis.document?.addEventListener('visibilitychange', visible);
  const poll = setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') request(); }, interval);
  request();
  return {
    request,
    stop() { stopped = true; clearTimeout(timer); clearInterval(poll); unsubscribe(); globalThis.window?.removeEventListener('online', online); globalThis.document?.removeEventListener('visibilitychange', visible); },
  };
}
