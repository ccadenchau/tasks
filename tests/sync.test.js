import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, newTask, removeTask } from '../js/model.js';
import { initialSync, recordChanges, mergeSync, syncedData } from '../js/sync-model.js';
import { passwordAuthorization } from '../js/sign-in.js';
import { createSyncApi } from '../js/sync-api.js';
import { startCloudSync } from '../js/sync.js';
import { createStore } from '../js/store.js';

function database(data = emptyData()) {
  let saved = { data: structuredClone(data), sync: initialSync(data), revision: 0 };
  return {
    channelName: crypto.randomUUID(),
    load: async () => structuredClone(saved),
    getBlob: async () => undefined,
    async commit(before, after, expected, blobs, replace, remote) {
      assert.equal(expected, saved.revision);
      saved = { data: structuredClone(after), sync: remote || recordChanges(saved.sync, before, after), revision: expected + 1 };
      return saved.revision;
    },
  };
}
async function waitFor(predicate) {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Sync timed out');
}

test('record sync converges across concurrent edits and preserves deletions', () => {
  const data = emptyData(); data.tasks.push(newTask('Original'));
  const a = initialSync(data), b = { ...structuredClone(a), replica: 'another-device' };
  const nextA = structuredClone(data), nextB = structuredClone(data);
  nextA.tasks[0].title = 'Edited'; nextB.tasks.push(newTask('Another task'));
  const left = recordChanges(a, data, nextA, Date.now() + 1), right = recordChanges(b, data, nextB, Date.now() + 2);
  assert.deepEqual(syncedData(mergeSync(left, right)), syncedData(mergeSync(right, left)));
  assert.deepEqual(syncedData(mergeSync(left, right)).tasks.map(task => task.title).sort(), ['Another task', 'Edited']);
  const deleted = structuredClone(nextA); removeTask(deleted, nextA.tasks[0].id);
  const tombstone = recordChanges(left, nextA, deleted, Date.now() + 10);
  assert(!syncedData(mergeSync(tombstone, right)).tasks.some(task => task.id === data.tasks[0].id));
});

test('sync merge removes dangling tag and parent links after concurrent deletion', () => {
  const data = emptyData(); data.tags.push({ id: 'tag', name: 'Tag', color: '#ff0000' });
  const parent = newTask('Parent'), child = { ...newTask('Child'), parentTaskId: parent.id, tagIds: ['tag'] };
  data.tasks.push(parent, child);
  const initial = initialSync(data), deleted = structuredClone(data);
  removeTask(deleted, parent.id); deleted.tags = []; deleted.tasks[0].tagIds = [];
  const removal = recordChanges(initial, data, deleted, Date.now() + 1), edited = structuredClone(data);
  edited.tasks[1].title = 'Updated child';
  const merged = syncedData(mergeSync(removal, recordChanges({ ...initial, replica: 'other' }, data, edited, Date.now() + 2)));
  assert.equal(merged.tasks[0].parentTaskId, null);
  assert.deepEqual(merged.tasks[0].tagIds, []);
});

test('browser API authenticates only to the configured API, paginates keys, and chunks attachment bytes', async () => {
  const requests = [], values = new Map();
  const authorization = passwordAuthorization('sync-test-only');
  const api = createSyncApi(authorization, async (url, options) => {
    const parsed = new URL(url, 'https://tasks.cadenchau.com'); requests.push({ parsed, options });
    assert(url.startsWith('https://api.cadenchau.com/api/v1/collections'));
    assert.equal(parsed.origin, 'https://api.cadenchau.com');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.mode, 'cors');
    assert.equal(options.headers.Authorization, authorization);
    const key = parsed.searchParams.get('key');
    if (options.method === 'PUT') { values.set(key, JSON.parse(options.body)); return Response.json(values.get(key)); }
    if (parsed.pathname.endsWith('/keys')) return Response.json(parsed.searchParams.get('offset') === '0' ? Array.from({ length: 1000 }, (_, i) => String(i)) : ['last']);
    return Response.json(values.get(key));
  });
  assert.equal((await api.keys()).length, 1001);
  const bytes = Uint8Array.from({ length: 400000 }, (_, i) => i % 256), file = { id: 'file', name: 'file.bin', size: bytes.length, type: 'application/octet-stream' };
  await api.uploadFile(file, new Blob([bytes]));
  assert.equal(values.size, 3);
  assert.deepEqual(new Uint8Array(await (await api.downloadFile(file)).arrayBuffer()), bytes);
  assert(requests.every(({ parsed }) => parsed.pathname.includes('/tasks_cadenchau_com/')));
});

test('API uses the same-origin development proxy on localhost', async () => {
  const originalLocation = globalThis.location;
  globalThis.location = { hostname: 'localhost' };
  try {
    const api = createSyncApi(passwordAuthorization('sync-test-only'), async (url, options) => {
      assert(url.startsWith('/__api/api/v1/collections/'));
      assert.equal(options.mode, 'same-origin');
      assert.equal(options.headers.Authorization, passwordAuthorization('sync-test-only'));
      return Response.json([]);
    });
    assert.deepEqual(await api.keys(), []);
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});

test('automatic sync uploads existing data, restores another device, and retries offline edits', async () => {
  const values = new Map(); let offline = false;
  const api = {
    async keys() { if (offline) throw new Error('Offline'); return [...values.keys()]; },
    read: async key => structuredClone(values.get(key)),
    write: async (key, value) => { values.set(key, structuredClone(value)); },
  };
  const original = emptyData(); original.tasks.push(newTask('Existing checklist'));
  const first = database(original), second = database();
  const a = createStore(first, await first.load()), b = createStore(second, await second.load());
  const left = startCloudSync(a, first, { api, delay: 5, interval: 100000 }); let right;
  try {
    await waitFor(() => a.getState().ui.syncStatus?.kind === 'synced');
    assert.equal(values.size, 1);
    right = startCloudSync(b, second, { api, delay: 5, interval: 100000 });
    await waitFor(() => b.getState().data.tasks.length === 1 && b.getState().ui.syncStatus?.kind === 'synced');
    assert.equal(b.getState().data.tasks[0].title, 'Existing checklist');
    offline = true;
    await a.mutate(data => { data.tasks[0].markdown = 'Offline note'; });
    await waitFor(() => a.getState().ui.syncStatus?.kind === 'error');
    assert.equal((await first.load()).data.tasks[0].markdown, 'Offline note');
    offline = false; left.request();
    await waitFor(() => a.getState().ui.syncStatus?.kind === 'synced');
    right.request();
    await waitFor(() => b.getState().data.tasks[0].markdown === 'Offline note');
  } finally { left.stop(); right?.stop(); a.destroy(); b.destroy(); }
});
