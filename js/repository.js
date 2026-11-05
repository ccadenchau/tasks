import { COLLECTIONS, emptyData } from './model.js';
import { initialSync, recordChanges } from './sync-model.js';

const value = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const finished = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error || new Error('Save cancelled.'));
  transaction.onerror = () => {};
});

export async function openRepository(name = 'taskspace-db') {
  if (!globalThis.indexedDB) throw new Error('Browser storage is unavailable.');
  const request = indexedDB.open(name, 2);
  request.onupgradeneeded = () => {
    const database = request.result;
    // Retain older stores so removing features never removes existing records.
    for (const name of [...COLLECTIONS, 'attachmentBlobs', 'meta']) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
  };
  request.onblocked = () => globalThis.dispatchEvent(new Event('database-blocked'));
  const database = await value(request);
  database.onversionchange = () => { database.close(); globalThis.dispatchEvent(new Event('database-blocked')); };
  const names = [...COLLECTIONS, 'attachmentBlobs', 'meta'];

  async function load() {
    const transaction = database.transaction([...COLLECTIONS, 'meta'], 'readonly');
    const done = finished(transaction);
    const results = await Promise.all([...COLLECTIONS.map(name => value(transaction.objectStore(name).getAll())), value(transaction.objectStore('meta').get('revision')), value(transaction.objectStore('meta').get('sync'))]);
    await done;
    return { data: { ...emptyData(), ...Object.fromEntries(COLLECTIONS.map((name, index) => [name, results[index]])) }, revision: results[COLLECTIONS.length]?.value || 0, sync: results.at(-1)?.value || null };
  }

  async function commit(before, after, revision, blobs = [], replace = false, remoteSync = null) {
    const transaction = database.transaction(names, 'readwrite');
    const done = finished(transaction);
    let stale = false;
    const check = transaction.objectStore('meta').get('revision');
    const sync = transaction.objectStore('meta').get('sync');
    check.onsuccess = () => {
      if ((check.result?.value || 0) !== revision) { stale = true; transaction.abort(); return; }
      try {
        for (const name of COLLECTIONS) {
          const store = transaction.objectStore(name), previous = new Map(before[name].map(record => [record.id, record])), nextIds = new Set(after[name].map(record => record.id));
          if (replace) store.clear();
          else for (const id of previous.keys()) if (!nextIds.has(id)) store.delete(id);
          for (const record of after[name]) if (replace || JSON.stringify(record) !== JSON.stringify(previous.get(record.id))) store.put(record);
        }
        if (replace) transaction.objectStore('attachmentBlobs').clear();
        for (const file of blobs) {
          if (file.blob) transaction.objectStore('attachmentBlobs').put(file);
          else transaction.objectStore('attachmentBlobs').delete(file.id);
        }
        transaction.objectStore('meta').put({ id: 'revision', value: revision + 1 });
        sync.onsuccess = () => {
          try { transaction.objectStore('meta').put({ id: 'sync', value: remoteSync || recordChanges(sync.result?.value || initialSync(before), before, after) }); }
          catch { transaction.abort(); }
        };
      } catch { transaction.abort(); }
    };
    try { await done; }
    catch (error) {
      if (stale) throw new Error('Data changed in another tab. Retry your change.');
      if (error.name === 'QuotaExceededError') throw new Error('Browser storage is full. Export a backup before removing files.');
      throw error;
    }
    return revision + 1;
  }

  async function getBlob(id) {
    const transaction = database.transaction('attachmentBlobs', 'readonly');
    return (await value(transaction.objectStore('attachmentBlobs').get(id)))?.blob;
  }
  return { load, commit, getBlob, channelName: `${name}-changes`, close: () => database.close() };
}
