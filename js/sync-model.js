import { COLLECTIONS, emptyData, validateData } from './model.js';

const key = entry => JSON.stringify([entry.collection, entry.id]);
const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

export function initialSync(data) {
  const replica = crypto.randomUUID();
  return { version: 1, replica, clock: 0, entries: COLLECTIONS.flatMap(collection => data[collection].map(value => ({ collection, id: value.id, stamp: [Math.max(0, Date.parse(value.updatedAt || value.createdAt) || 0), replica], value }))) };
}

export function recordChanges(sync, before, after, time = Date.now()) {
  const next = structuredClone(sync), entries = new Map(next.entries.map(entry => [key(entry), entry]));
  next.clock = next.entries.reduce((clock, entry) => Math.max(clock, entry.stamp[0] + 1), Math.max(time, next.clock + 1));
  for (const collection of COLLECTIONS) {
    const previous = new Map(before[collection].map(value => [value.id, value]));
    const current = new Map(after[collection].map(value => [value.id, value]));
    for (const id of new Set([...previous.keys(), ...current.keys()])) {
      if (JSON.stringify(previous.get(id)) === JSON.stringify(current.get(id))) continue;
      const entry = { collection, id, stamp: [next.clock, next.replica], value: current.get(id) || null };
      entries.set(key(entry), entry);
    }
  }
  next.entries = [...entries.values()];
  return next;
}

export function validateSync(sync) {
  if (sync?.version !== 1 || typeof sync.replica !== 'string' || !Number.isSafeInteger(sync.clock) || sync.clock < 0 || !Array.isArray(sync.entries) || sync.entries.length > 200000) throw new Error('Invalid cloud checklist.');
  const seen = new Set();
  for (const entry of sync.entries) {
    if (!COLLECTIONS.includes(entry.collection) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 200 || !Array.isArray(entry.stamp) || entry.stamp.length !== 2 || !Number.isSafeInteger(entry.stamp[0]) || entry.stamp[0] < 0 || typeof entry.stamp[1] !== 'string' || (entry.value !== null && entry.value?.id !== entry.id) || seen.has(key(entry))) throw new Error('Invalid cloud checklist record.');
    seen.add(key(entry));
  }
  return sync;
}

export function mergeSync(local, remote) {
  validateSync(remote);
  const entries = new Map(local.entries.map(entry => [key(entry), entry]));
  for (const entry of remote.entries) {
    const existing = entries.get(key(entry));
    if (!existing || newer(entry.stamp, existing.stamp)) entries.set(key(entry), entry);
  }
  return { ...local, clock: Math.max(local.clock, remote.clock), entries: [...entries.values()].sort((a, b) => key(a).localeCompare(key(b))) };
}

export function syncedData(sync) {
  const data = emptyData();
  for (const entry of sync.entries) if (entry.value !== null) data[entry.collection].push(structuredClone(entry.value));
  const tasks = new Map(data.tasks.map(task => [task.id, task])), tags = new Set(data.tags.map(tag => tag.id)), pages = new Set(data.pages.map(page => page.id));
  for (const task of data.tasks) {
    task.tagIds = Array.isArray(task.tagIds) ? task.tagIds.filter(id => tags.has(id)) : task.tagIds;
    task.pageIds = Array.isArray(task.pageIds) ? task.pageIds.filter(id => pages.has(id)) : task.pageIds;
    const seen = new Set([task.id]); let parent = task.parentTaskId;
    while (parent) {
      if (!tasks.has(parent) || seen.has(parent)) { task.parentTaskId = null; break; }
      seen.add(parent); parent = tasks.get(parent).parentTaskId;
    }
  }
  data.attachments = data.attachments.filter(file => (file.ownerType === 'task' ? tasks : pages).has(file.ownerId));
  return validateData(data);
}
