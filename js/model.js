import { documentFromText, documentText, documentToMarkdown, validateDocument } from './document.js';
import { normalizeColor } from './tag-colors.js';

export const COLLECTIONS = ['tasks', 'pages', 'tags', 'attachments'];
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function emptyData() {
  return Object.fromEntries(COLLECTIONS.map(name => [name, []]));
}

export function newTask(title, position = 0) {
  const time = now();
  return { id: uid(), title: title.trim(), description: '', markdown: '', document: documentFromText(), parentTaskId: null, status: 'open', dueAt: null, tagIds: [], pageIds: [], position, createdAt: time, updatedAt: time, completedAt: null, archivedAt: null };
}

export function validateData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid backup.');
  const ids = {};
  for (const name of COLLECTIONS) {
    if (!Array.isArray(data[name]) || data[name].length > 50000) throw new Error(`Invalid ${name}.`);
    ids[name] = new Set();
    for (const record of data[name]) {
      if (!record || typeof record.id !== 'string' || !record.id || record.id.length > 200 || ids[name].has(record.id)) throw new Error(`Invalid or duplicate ${name} ID.`);
      ids[name].add(record.id);
    }
  }
  const tasksById = new Map(data.tasks.map(task => [task.id, task])), checkedParents = new Set();
  for (const task of data.tasks) {
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 1000 || typeof task.description !== 'string' || task.description.length > 1000000) throw new Error('Invalid task.');
    if (!['open', 'in_progress', 'done'].includes(task.status) || !Number.isFinite(task.position)) throw new Error('Invalid task status or order.');
    if (task.dueAt && !validDate(task.dueAt)) throw new Error('Invalid due date.');
    if (task.document !== undefined) validateDocument(task.document);
    if (task.markdown !== undefined && (typeof task.markdown !== 'string' || task.markdown.length > 1000000)) throw new Error('Invalid Markdown notes.');
    const chain = new Set([task.id]); let parent = task.parentTaskId;
    while (parent) {
      if (chain.has(parent) || !tasksById.has(parent)) throw new Error('Invalid subtask hierarchy.');
      if (checkedParents.has(parent)) break;
      chain.add(parent); parent = tasksById.get(parent).parentTaskId;
    }
    for (const id of chain) checkedParents.add(id);
    if (!Array.isArray(task.tagIds) || task.tagIds.some(id => !ids.tags.has(id)) || !Array.isArray(task.pageIds) || task.pageIds.some(id => !ids.pages.has(id))) throw new Error('Invalid task links.');
  }
  for (const tag of data.tags) {
    if (typeof tag.name !== 'string' || !tag.name.trim() || tag.name.length > 100) throw new Error('Invalid tag.');
    normalizeColor(tag.color || 'blue');
  }
  for (const page of data.pages) {
    if (typeof page.title !== 'string' || !page.title.trim() || page.title.length > 1000 || typeof noteText(page) !== 'string' || noteText(page).length > 1000000) throw new Error('Invalid note.');
  }
  for (const file of data.attachments) {
    if (typeof file.name !== 'string' || !file.name || typeof file.type !== 'string' || file.type.length > 200 || !Number.isInteger(file.size) || file.size < 0 || file.size > 25 * 1024 * 1024 || !['task', 'page'].includes(file.ownerType) || !(file.ownerType === 'task' ? ids.tasks : ids.pages).has(file.ownerId)) throw new Error('Invalid attachment.');
  }
  return data;
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export const noteText = page => page.body ?? page.plainText ?? '';

export const searchText = value => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function visibleTasks(data, { query = '', status = 'active', sort = 'manual', direction = 'asc', tagIds = [] } = {}) {
  const tags = new Map(data.tags.map(tag => [tag.id, tag.name]));
  const parts = (query.match(/(?:tag:)?"[^"]*"|\S+/g) || []).map(value => ({ tag: value.toLowerCase().startsWith('tag:'), value: searchText(value.replace(/^tag:/i, '').replace(/^"|"$/g, '')) })).filter(part => part.value);
  const multiplier = direction === 'desc' ? -1 : 1;
  return data.tasks.filter(task => {
    if (task.archivedAt || (!parts.length && status !== 'all' && (status === 'done' ? task.status !== 'done' : task.status === 'done'))) return false;
    if (!parts.length && !tagIds.length && task.parentTaskId) return false;
    if (!tagIds.every(id => task.tagIds.includes(id))) return false;
    const names = task.tagIds.map(id => tags.get(id) || '').join(' ');
    const text = searchText(`${task.title} ${task.description} ${task.markdown || ''} ${task.document ? documentText(task.document) : ''} ${names}`);
    return parts.every(part => (part.tag ? task.tagIds.some(id => searchText(tags.get(id) || '').includes(part.value)) : text.includes(part.value)));
  }).sort((a, b) => {
    if (sort === 'title') return multiplier * a.title.localeCompare(b.title) || a.position - b.position;
    if (sort === 'due' || sort === 'created') {
      const key = sort === 'due' ? 'dueAt' : 'createdAt';
      if (!a[key] || !b[key]) return a[key] ? -1 : b[key] ? 1 : a.position - b.position;
      return multiplier * a[key].localeCompare(b[key]) || a.position - b.position;
    }
    return a.position - b.position;
  });
}

export function addSubtask(data, parentId, title) {
  const parent = data.tasks.find(task => task.id === parentId);
  if (!parent) throw new Error('Parent task not found.');
  if (!title.trim()) throw new Error('Enter a subtask name.');
  const task = { ...newTask(title, Math.max(-1, ...data.tasks.map(task => task.position)) + 1), parentTaskId: parentId, tagIds: [...parent.tagIds] };
  data.tasks.push(task); return task.id;
}

export function setTaskStatus(data, id, status) {
  const task = data.tasks.find(task => task.id === id);
  if (!task) throw new Error('Task not found.');
  if (!['open', 'in_progress', 'done'].includes(status)) throw new Error('Invalid status.');
  task.status = status; task.completedAt = status === 'done' ? now() : null; task.updatedAt = now();
}

export function saveTag(data, fields) {
  const name = fields.name.trim().replace(/^#/, '');
  if (!name || name.length > 100) throw new Error('Enter a tag name.');
  const color = normalizeColor(fields.color);
  if (data.tags.some(tag => tag.id !== fields.id && tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A tag with this name already exists.');
  let tag = data.tags.find(tag => tag.id === fields.id);
  if (fields.id && !tag) throw new Error('Tag not found.');
  if (tag) Object.assign(tag, { name, color });
  else { tag = { id: uid(), name, color, position: Math.max(-1, ...data.tags.map(tag => tag.position || 0)) + 1 }; data.tags.push(tag); }
  return tag.id;
}

export function deleteTag(data, id) {
  data.tags = data.tags.filter(tag => tag.id !== id);
  data.tasks.forEach(task => { task.tagIds = task.tagIds.filter(tagId => tagId !== id); });
}

export function migrateDocuments(data) {
  let changed = false;
  const linked = new Set(data.tasks.flatMap(task => task.pageIds));
  function pageDocument(page) {
    if (page.body === undefined && page.content) { try { return structuredClone(validateDocument(page.content)); } catch { /* Fall back to the saved text projection. */ } }
    return documentFromText(noteText(page));
  }
  for (const task of data.tasks) if (!task.document) {
    const blocks = task.description ? documentFromText(task.description).blocks : [];
    for (const id of task.pageIds) {
      const page = data.pages.find(page => page.id === id);
      if (page) blocks.push({ type: 'heading', level: 2, children: [{ text: page.title }] }, ...pageDocument(page).blocks);
    }
    task.document = { version: 1, blocks: blocks.length ? blocks : documentFromText().blocks };
    task.description = documentText(task.document); task.markdown = documentToMarkdown(task.document); changed = true;
  }
  for (const page of data.pages) if (!linked.has(page.id) && !page.archivedAt) {
    const task = newTask(page.title, Math.max(-1, ...data.tasks.map(task => task.position)) + 1);
    task.pageIds = [page.id]; task.document = pageDocument(page); task.description = documentText(task.document); task.markdown = documentToMarkdown(task.document); data.tasks.push(task); changed = true;
  }
  for (const task of data.tasks) if (task.markdown === undefined) { task.markdown = documentToMarkdown(task.document); changed = true; }
  return changed;
}

export function removeTask(data, id) {
  data.tasks = data.tasks.filter(task => task.id !== id);
  data.tasks.forEach(task => { if (task.parentTaskId === id) task.parentTaskId = null; });
  const removedFiles = data.attachments.filter(file => file.ownerType === 'task' && file.ownerId === id);
  data.attachments = data.attachments.filter(file => !removedFiles.includes(file));
  return removedFiles.map(file => ({ id: file.id }));
}
