import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addSubtask, removeTask, deleteTag, emptyData, migrateDocuments, newTask, noteText, saveTag, setTaskStatus, validateData, validDate, visibleTasks } from '../js/model.js';
import { clampPanelWidth } from '../js/panel-resize.js';
import { handleShortcut } from '../js/shortcuts.js';
import { markdownParser, markdownSerializer, markdownSchema, markdownInputRules } from '../js/inline-markdown.js';
import { EditorState, inputRules } from '../js/vendor/prosemirror.js';
import { documentFromText, documentText, documentToMarkdown, safeUrl, validateDocument } from '../js/document.js';
import { createStore } from '../js/store.js';
import { createTaskSession } from '../js/task-session.js';
import { createStatusActions, displayData } from '../js/status-actions.js';
import { normalizeColor, tagAppearance, TAG_PALETTE } from '../js/tag-colors.js';
import { createBackup, readBackup } from '../js/backup.js';
import { App } from '../js/ui.js';

function sample() {
  const data = emptyData();
  data.tasks = [newTask('First task', 0), newTask('Second task', 1)];
  data.tags = [{ id: 'tag', name: 'study', color: 'blue', position: 0 }];
  data.tasks[0].tagIds = ['tag'];
  data.pages = [{ id: 'note', title: 'A note', body: 'Some text.', updatedAt: new Date().toISOString() }];
  data.tasks[0].pageIds = ['note'];
  return data;
}

function memoryRepository(data) {
  let stored = structuredClone(data), revision = 0;
  return {
    channelName: crypto.randomUUID(),
    async load() { return { data: structuredClone(stored), revision }; },
    async commit(before, next, expected) { if (expected !== revision) throw new Error('Stale revision'); stored = structuredClone(next); return ++revision; },
  };
}

test('new data starts empty without examples or removed feature collections', () => {
  assert.deepEqual(emptyData(), { tasks: [], pages: [], tags: [], attachments: [] });
  validateData(emptyData());
});

test('search, completion filtering, due sorting, and manual order work together', () => {
  const data = sample(); data.tasks[0].dueAt = '2026-11-05'; data.tasks[1].dueAt = '2026-11-04';
  assert.equal(visibleTasks(data, { query: 'study' }).length, 1);
  assert.equal(visibleTasks(data, { sort: 'due' })[0].title, 'Second task');
  setTaskStatus(data, data.tasks[0].id, 'done');
  assert.equal(visibleTasks(data).length, 1);
  assert.equal(visibleTasks(data, { status: 'done' })[0].title, 'First task');
  assert.equal(visibleTasks(data, { status: 'all' }).length, 2);
  setTaskStatus(data, data.tasks[0].id, 'open');
  assert.equal(data.tasks[0].completedAt, null);
});

test('task autosave retains existing note links and legacy fields', async () => {
  const data = sample(); data.tasks[0].legacyField = 'preserved';
  const store = createStore(memoryRepository(data), { data, revision: 0 });
  const session = createTaskSession(data.tasks[0], store, { delay: 100000 });
  try {
    session.change({ title: ' Revised ', markdown: 'Notes', document: documentFromText('Notes'), dueAt: '2026-11-04' });
    await session.flush();
    const saved = store.getState().data; validateData(saved);
    assert.equal(saved.tasks[0].title, 'Revised');
    assert.equal(saved.tasks[0].legacyField, 'preserved');
    assert.equal(saved.tasks[0].markdown, 'Notes');
    assert.deepEqual(saved.tasks[0].pageIds, ['note']);
    assert.deepEqual(saved.tasks[0].tagIds, ['tag']);
  } finally { session.dispose(); store.destroy(); }
});

test('older rich-text notes retain content while displaying the text projection', () => {
  const page = { title: 'Old note', content: { version: 1, blocks: [{ type: 'paragraph', children: [{ text: 'Original' }] }] }, plainText: 'Original' };
  assert.equal(noteText(page), 'Original');
  page.body = 'Edited'; assert.equal(noteText(page), 'Edited');
  assert.equal(page.content.blocks[0].children[0].text, 'Original');
});

test('validation rejects malformed records, invalid calendar dates, and broken links', () => {
  assert(validDate('2024-02-29')); assert(!validDate('2026-02-29')); assert(!validDate('2026-13-01'));
  const duplicate = sample(); duplicate.tasks.push(duplicate.tasks[0]); assert.throws(() => validateData(duplicate), /duplicate/);
  const missing = sample(); missing.tasks[0].pageIds.push('missing'); assert.throws(() => validateData(missing), /links/);
  const title = sample(); title.tasks[0].title = ' '; assert.throws(() => validateData(title), /task/);
});

test('deleting a task preserves its note and detaches existing subtasks', () => {
  const data = sample(), parent = data.tasks[0].id;
  data.tasks[1].parentTaskId = parent;
  data.attachments = [{ id: 'file', name: 'a.txt', type: 'text/plain', size: 1, ownerType: 'task', ownerId: parent }];
  assert.deepEqual(removeTask(data, parent), [{ id: 'file' }]);
  assert.equal(data.pages.length, 1); assert.equal(data.tasks[0].parentTaskId, null); assert.equal(data.attachments.length, 0);
  validateData(data);
});



test('queued rapid completion updates persist the final state', async () => {
  const data = sample(), repository = memoryRepository(data), store = createStore(repository, { data, revision: 0 }), id = data.tasks[0].id;
  try {
    await Promise.all([store.mutate(data => setTaskStatus(data, id, 'done')), store.mutate(data => setTaskStatus(data, id, 'open'))]);
    assert.equal(store.getState().data.tasks[0].status, 'open');
    assert.equal((await repository.load()).data.tasks[0].status, 'open');
    assert.equal(store.getState().revision, 2);
  } finally { store.destroy(); }
});

test('failed persistence retains the last committed data and reports the error', async () => {
  const data = sample(), repository = memoryRepository(data);
  repository.commit = async () => { throw new Error('Storage full'); };
  const store = createStore(repository, { data, revision: 0 });
  try {
    await assert.rejects(store.mutate(data => { data.tasks[0].title = 'Unsaved'; }), /Storage full/);
    assert.equal(store.getState().data.tasks[0].title, 'First task');
    assert.equal(store.getState().saving, false); assert.equal(store.getState().error, 'Storage full');
  } finally { store.destroy(); }
});

test('JSON backup round-trip retains existing attachment bytes and note formatting data', async () => {
  const data = sample(), bytes = new Blob(['test\n✓\u0000'], { type: 'text/plain' });
  data.attachments.push({ id: 'file', name: 'test.txt', type: bytes.type, size: bytes.size, ownerType: 'task', ownerId: data.tasks[0].id });
  const backup = await createBackup(data, { getBlob: async () => bytes });
  const restored = await readBackup(backup);
  assert.deepEqual(restored.data, data); assert.equal(await restored.blobs[0].blob.text(), await bytes.text());
});

test('malformed backups and duplicate or missing attachment bytes are rejected', async () => {
  await assert.rejects(readBackup(new Blob(['{bad}'])));
  await assert.rejects(readBackup(new Blob([JSON.stringify({ version: 99, files: [] })])), /Unsupported/);
  const data = sample(); data.attachments.push({ id: 'file', name: 'x', type: 'text/plain', size: 1, ownerType: 'task', ownerId: data.tasks[0].id });
  await assert.rejects(readBackup(new Blob([JSON.stringify({ version: 2, data, files: [] })])), /Missing/);
  await assert.rejects(readBackup(new Blob([JSON.stringify({ version: 2, data, files: [{ id: 'file', base64: '!!!!' }] })])), /Invalid/);
  await assert.rejects(createBackup(data, { getBlob: async () => undefined }), /Missing/);
});

test('task notes open in a non-modal side panel with no standalone note creation', () => {
  const data = sample(), state = { data, revision: 0, ui: { query: '', status: 'active', sort: 'manual', direction: 'asc', view: 'list', tagIds: [], limit: 100, editing: null }, saving: false, error: '' }, ctx = { store: {}, getDraft: () => data.tasks[0] };
  function text(node) { return typeof node.tag === 'symbol' ? node.text : node.children.map(text).join(' '); }
  function nodes(node) { return [node, ...node.children.flatMap(nodes)]; }
  for (const view of ['list', 'board']) {
    state.ui.view = view;
    const tree = App(state, ctx), rendered = text(tree);
    assert(!/workspace|inbox|project|saved view|locally yours|New note|clarity/i.test(rendered));
    assert(!nodes(tree).some(node => ['select', 'dialog'].includes(node.tag)));
  }
  state.ui.editing = { id: data.tasks[0].id }; state.ui.editStatus = 'Saved';
  const tree = App(state, ctx);
  assert(nodes(tree).some(node => node.tag === 'aside' && node.props['aria-label'] === 'Task details'));
  assert(nodes(tree).some(node => node.props.class === 'document-host'));
  assert(!nodes(tree).some(node => node.props['aria-modal']));
  state.ui.tagsOpen = true;
  assert(nodes(App(state, ctx)).some(node => node.tag === 'dialog' && node.props['aria-labelledby'] === 'tag-modal-title'));
  assert(nodes(App(state, ctx)).some(node => node.tag === 'input' && node.props.type === 'color' && node.props.name === 'color'));
});

test('colored tags can be created, renamed, recolored, and removed without deleting tasks', () => {
  const data = sample();
  const id = saveTag(data, { name: 'Review', color: 'violet' });
  data.tasks[1].tagIds = [id]; validateData(data);
  saveTag(data, { id, name: 'Reviewed', color: 'green' });
  assert.equal(data.tags.find(tag => tag.id === id).color, TAG_PALETTE.green);
  assert.equal(visibleTasks(data, { query: 'reviewed' })[0].id, data.tasks[1].id);
  assert.throws(() => saveTag(data, { name: 'STUDY', color: 'blue' }), /already exists/);
  assert.throws(() => saveTag(data, { name: 'Unsafe', color: 'url(javascript:bad)' }), /color/);
  deleteTag(data, id); assert.equal(data.tasks.length, 2); assert.deepEqual(data.tasks[1].tagIds, []);
  validateData(data);
});

test('tag intersections and clickable-column sort directions preserve undated tasks last', () => {
  const data = sample(), secondTag = saveTag(data, { name: 'work', color: 'blue' });
  data.tasks[0].tagIds.push(secondTag); data.tasks[1].tagIds = [secondTag];
  data.tasks[0].dueAt = '2026-11-04'; data.tasks.push(newTask('A task', 2));
  assert.equal(visibleTasks(data, { tagIds: ['tag', secondTag] }).length, 1);
  assert.equal(visibleTasks(data, { sort: 'title', direction: 'asc' })[0].title, 'A task');
  assert.equal(visibleTasks(data, { sort: 'title', direction: 'desc' })[0].title, 'Second task');
  assert.equal(visibleTasks(data, { sort: 'due', direction: 'desc' })[0].title, 'First task');
  setTaskStatus(data, data.tasks[0].id, 'in_progress'); assert.equal(data.tasks[0].status, 'in_progress');
  setTaskStatus(data, data.tasks[0].id, 'done'); assert(data.tasks[0].completedAt);
});

test('legacy notes migrate into their task documents and unlinked notes become tasks exactly once', () => {
  const data = sample(); delete data.tasks[0].document; delete data.tasks[1].document;
  data.tasks[0].description = 'Existing task notes';
  data.pages.push({ id: 'unlinked', title: 'Old standalone note', body: 'Do not lose this.' });
  assert(migrateDocuments(data)); validateData(data);
  assert(documentText(data.tasks[0].document).includes('Some text.'));
  assert(documentText(data.tasks[0].document).includes('Existing task notes'));
  assert.equal(data.tasks.find(task => task.pageIds.includes('unlinked')).description, 'Do not lose this.');
  assert.equal(data.tasks.length, 3); assert.equal(migrateDocuments(data), false);
});

test('document schema keeps formatting and rejects unsafe links and unsupported blocks', () => {
  const content = { version: 1, blocks: [{ type: 'heading', level: 2, children: [{ text: 'Heading' }] }, { type: 'paragraph', children: [{ text: 'Bold link', marks: ['bold', 'underline'], href: 'https://example.com/' }] }] };
  validateDocument(content); assert.equal(documentText(content), 'Heading\nBold link');
  const unsafe = structuredClone(content); unsafe.blocks[1].children[0].href = 'javascript:alert(1)'; assert.throws(() => validateDocument(unsafe), /link/);
  assert.equal(safeUrl('data:text/html,bad'), null); assert.equal(safeUrl('mailto:a@example.com'), 'mailto:a@example.com');
  assert.throws(() => validateDocument({ version: 1, blocks: [{ type: 'script', children: [] }] }));
  assert.throws(() => validateDocument({ version: 1, blocks: [{ type: 'heading', level: 9, children: [] }] }));
});



test('formatted task notes and tag colors survive persistence and backup reload', async () => {
  const data = sample(), repository = memoryRepository(data), store = createStore(repository, { data, revision: 0 });
  const content = documentFromText('Document text'); content.blocks[0].children[0].marks = ['italic'];
  const session = createTaskSession(data.tasks[0], store, { delay: 100000 });
  try {
    session.change({ document: content, markdown: documentToMarkdown(content), tagIds: ['tag'] });
    await session.flush();
    const saved = await repository.load();
    const backup = await createBackup(saved.data, repository), restored = await readBackup(backup);
    assert.deepEqual(restored.data.tasks[0].document, content);
    assert.equal(restored.data.tasks[0].markdown, '*Document text*');
    assert.equal(restored.data.tags[0].color, 'blue');
    assert.equal(visibleTasks(restored.data, { query: 'document text' }).length, 1);
  } finally { session.dispose(); store.destroy(); }
});

test('typing during autosave and overlapping flush requests retain the latest document', async () => {
  const data = sample(), repository = memoryRepository(data), commit = repository.commit;
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let writes = 0;
  repository.commit = async (...args) => { if (++writes === 1) { entered(); await gate; } return commit(...args); };
  const store = createStore(repository, { data, revision: 0 });
  const session = createTaskSession(data.tasks[0], store, { delay: 100000 });
  try {
    session.change({ document: documentFromText('First draft') });
    const firstSave = session.flush(); await started;
    session.change({ document: documentFromText('Latest draft') });
    const secondSave = session.flush(); release();
    await Promise.all([firstSave, secondSave]);
    assert.equal(documentText(store.getState().data.tasks[0].document), 'Latest draft');
    assert.equal(store.getState().data.tasks[0].description, 'Latest draft');
    assert.equal(session.dirty, false); assert.equal(writes, 2);
  } finally { session.dispose(); store.destroy(); }
});

test('failed autosave preserves the draft and can retry without closing the task', async () => {
  const data = sample(), repository = memoryRepository(data), commit = repository.commit;
  let failing = true; const statuses = [];
  repository.commit = async (...args) => { if (failing) throw new Error('Storage unavailable'); return commit(...args); };
  const store = createStore(repository, { data, revision: 0 });
  const session = createTaskSession(data.tasks[0], store, { delay: 100000, onStatus: status => statuses.push(status) });
  try {
    session.change({ document: documentFromText('Keep my draft') });
    await assert.rejects(session.flush(), /Storage unavailable/);
    assert(session.dirty); assert.equal(documentText(session.draft.document), 'Keep my draft'); assert(statuses.includes('Save failed'));
    failing = false; await session.flush();
    assert.equal(store.getState().data.tasks[0].description, 'Keep my draft'); assert.equal(session.dirty, false);
  } finally { session.dispose(); store.destroy(); }
});

test('autosave rejects stale task edits while keeping the current and drafted notes intact', async () => {
  const data = sample(), store = createStore(memoryRepository(data), { data, revision: 0 });
  const session = createTaskSession(data.tasks[0], store, { delay: 100000 });
  try {
    session.change({ document: documentFromText('Local draft') });
    const other = createTaskSession(store.getState().data.tasks[0], store, { delay: 100000 });
    try { other.change({ document: documentFromText('Changed elsewhere') }); await other.flush(); } finally { other.dispose(); }
    await assert.rejects(session.flush(), /changed in another tab/);
    assert.equal(store.getState().data.tasks[0].description, 'Changed elsewhere');
    assert.equal(documentText(session.draft.document), 'Local draft'); assert(session.dirty);
  } finally { session.dispose(); store.destroy(); }
});

test('assigned tags appear in task details without a tag editor button in search', () => {
  const data = sample(), store = createStore(memoryRepository(data), { data, revision: 0 });
  const ctx = { store, getDraft: () => data.tasks[0] };
  const text = node => typeof node.tag === 'symbol' ? node.text : node.children.map(text).join(' ');
  const nodes = node => [node, ...node.children.flatMap(nodes)];
  try {
    assert(nodes(App(store.getState(), ctx)).some(node => node.props['aria-label'] === 'Task views'));
    store.ui({ editing: { id: data.tasks[0].id } });
    assert(text(App(store.getState(), ctx)).includes('study'));
    assert(!text(App(store.getState(), ctx)).includes('Edit tags'));
    store.ui({ tagSearchOpen: true, tagQuery: 'STU' });
    assert(text(App(store.getState(), ctx)).includes('study'));
    store.ui({ tagSearchOpen: false, tagQuery: '', tagsOpen: true });
    assert(text(App(store.getState(), ctx)).includes('study'));
    assert.equal(nodes(App(store.getState(), ctx)).filter(node => node.tag === 'dialog').length, 1);
    store.ui({ tagsOpen: false });
    const toggle = nodes(App(store.getState(), ctx)).filter(node => node.props.class === 'text-button view-toggle');
    assert.equal(toggle.length, 1); assert.equal(text(toggle[0]), 'Board view');
  } finally { store.destroy(); }
});

test('global search finds completed tasks, Markdown text, case variations, and tag names', () => {
  const data = sample();
  data.tasks[0].status = 'done';
  data.tasks[0].markdown = '# Café notes\n\nA **launch** meeting with a deadline.';
  assert.equal(visibleTasks(data, { query: 'CAFE launch' })[0].id, data.tasks[0].id);
  assert.equal(visibleTasks(data, { query: 'tag:STUDY meeting' })[0].id, data.tasks[0].id);
  assert.equal(visibleTasks(data, { query: '"launch meeting"' })[0].id, data.tasks[0].id);
  assert.equal(visibleTasks(data, { query: 'unrelated text' }).length, 0);
  assert.equal(visibleTasks(data).length, 1);
});

test('tag views include every assigned task regardless of completion state', () => {
  const data = sample(); data.tasks[0].status = 'done'; data.tasks[1].tagIds = ['tag'];
  const tasks = visibleTasks(data, { tagIds: ['tag'], status: 'all' });
  assert.equal(tasks.length, 2); assert(tasks.some(task => task.status === 'done'));
});

test('subtasks stay inside parents, can be searched, and complete independently', () => {
  const data = sample(), parent = data.tasks[0];
  const id = addSubtask(data, parent.id, 'Write release notes'); validateData(data);
  assert.equal(visibleTasks(data).length, 2);
  assert.deepEqual(data.tasks.find(task => task.id === id).tagIds, parent.tagIds);
  assert.equal(visibleTasks(data, { query: 'release notes' })[0].id, id);
  setTaskStatus(data, parent.id, 'done'); assert.equal(data.tasks.find(task => task.id === id).status, 'open');
  data.tasks[0].parentTaskId = id; assert.throws(() => validateData(data), /hierarchy/);
});

test('legacy formatted documents convert to Markdown without losing headings or emphasis', () => {
  const content = { version: 1, blocks: [{ type: 'heading', level: 2, children: [{ text: 'Old heading' }] }, { type: 'paragraph', children: [{ text: 'Important', marks: ['bold'] }] }] };
  assert.equal(documentToMarkdown(content), '## Old heading\n\n**Important**');
});

test('inline Markdown parses and serializes formatting, tables, and checklists without a separate preview', () => {
  const source = '# Heading\n\n**Bold** and *italic* with `code`.\n\n- [x] Finished\n- [ ] Next\n\n| Name | Value |\n| --- | --- |\n| Test | 1 |';
  const doc = markdownParser.parse(source), output = markdownSerializer.serialize(doc);
  assert.equal(doc.firstChild.type.name, 'heading');
  assert(output.includes('**Bold**') && output.includes('*italic*') && output.includes('`code`'));
  assert(output.includes('[x] Finished') && output.includes('[ ] Next'));
  assert(output.includes('| Test | 1 |'));
  assert.equal(markdownParser.parse(output).textContent, doc.textContent);
  const hostile = markdownParser.parse('[bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');
  const types = []; hostile.descendants(node => { types.push(node.type.name); assert(!node.marks.some(mark => mark.type.name === 'link' && mark.attrs.href.startsWith('javascript:'))); });
  assert(!types.includes('image'));
});

test('Markdown input rules format the text being typed and preserve subsequent plain typing', () => {
  function type(text) {
    let state = EditorState.create({ schema: markdownSchema, plugins: [inputRules({ rules: markdownInputRules() })] });
    const view = { get state() { return state; }, composing: false, dispatch(transaction) { state = state.apply(transaction); } };
    for (const character of text) {
      const { from, to } = state.selection;
      const handled = state.plugins.some(plugin => plugin.props.handleTextInput?.(view, from, to, character));
      if (!handled) view.dispatch(state.tr.insertText(character, from, to));
    }
    return state.doc;
  }
  const heading = type('# Heading'); assert.equal(heading.firstChild.type.name, 'heading'); assert.equal(heading.textContent, 'Heading');
  const bold = type('**Bold** tail'); assert.equal(bold.textContent, 'Bold tail'); assert.equal(bold.firstChild.firstChild.marks[0].type.name, 'strong'); assert.equal(bold.firstChild.lastChild.marks.length, 0);
  const italic = type('*Italic*'); assert.equal(italic.firstChild.firstChild.marks[0].type.name, 'em');
  const list = type('- Item'); assert.equal(list.firstChild.type.name, 'bullet_list');
  const task = type('- [ ] Item'); assert.equal(task.firstChild.firstChild.attrs.checked, false);
});

test('panel resizing preserves space for both panes and clamps oversized widths', () => {
  assert.equal(clampPanelWidth(500, 1000), 500);
  assert.equal(clampPanelWidth(2000, 1000), 713);
  assert.equal(clampPanelWidth(20, 1000), 260);
  assert.equal(clampPanelWidth('bad', 1000), 460);
});

test('task controls use an accessible trash icon, confirmation modal, and a bottom add button', () => {
  const data = sample(), store = createStore(memoryRepository(data), { data, revision: 0 });
  const ctx = { store, getDraft: () => data.tasks[0] };
  const nodes = node => [node, ...node.children.flatMap(nodes)];
  const text = node => typeof node.tag === 'symbol' ? node.text : node.children.map(text).join(' ');
  try {
    store.ui({ editing: { id: data.tasks[0].id } });
    const tree = App(store.getState(), ctx), all = nodes(tree), panel = all.find(node => node.tag === 'aside');
    assert(all.some(node => node.props.role === 'separator' && node.props['aria-label'] === 'Resize task panel'));
    assert(nodes(panel).some(node => node.tag === 'button' && node.props['aria-label'] === 'Delete task'));
    assert(!nodes(panel).some(node => node.tag === 'button' && text(node) === 'Close'));
    assert(!all.some(node => node.tag === 'form' && node.props.class === 'add-task'));
    assert(all.some(node => node.props.class === 'button button--primary add-task-fab'));
    store.ui({ confirmation: { key: 'delete', title: 'Delete task?', message: 'This task will be deleted.', action: () => {} } });
    assert(nodes(App(store.getState(), ctx)).some(node => node.tag === 'dialog' && node.props['aria-labelledby'] === 'confirmation-title'));
  } finally { store.destroy(); }
});

test('tag-specific views are available in both layouts and absent from tag management', () => {
  const data = sample(), store = createStore(memoryRepository(data), { data, revision: 0 }), selected = [];
  const ctx = { store, getDraft: () => null, viewTag: id => selected.push(id) };
  const nodes = node => [node, ...node.children.flatMap(nodes)];
  const text = node => typeof node.tag === 'symbol' ? node.text : node.children.map(text).join(' ');
  try {
    for (const view of ['list', 'board']) {
      store.ui({ view });
      const nav = nodes(App(store.getState(), ctx)).find(node => node.props['aria-label'] === 'Task views');
      const tag = nodes(nav).find(node => node.tag === 'button' && text(node).includes('study'));
      assert(tag); tag.props.onClick();
    }
    assert.deepEqual(selected, ['tag', 'tag']);
    store.ui({ tagsOpen: true, tagEdit: 'tag' });
    const modal = nodes(App(store.getState(), ctx)).find(node => node.tag === 'dialog');
    assert(!text(modal).includes('View tasks'));
    assert(!nodes(modal).some(node => node.props['aria-label'] === 'Task views'));
  } finally { store.destroy(); }
});

test('list view hides Manual and native autocomplete is disabled on rendered inputs', () => {
  const data = sample(), store = createStore(memoryRepository(data), { data, revision: 0 });
  const ctx = { store, getDraft: () => data.tasks[0] };
  const nodes = node => [node, ...node.children.flatMap(nodes)];
  const text = node => typeof node.tag === 'symbol' ? node.text : node.children.map(text).join(' ');
  try {
    store.ui({ editing: { id: data.tasks[0].id }, tagsOpen: true });
    const list = App(store.getState(), ctx);
    assert(!text(list).includes('Manual'));
    for (const node of nodes(list).filter(node => ['input', 'textarea', 'form'].includes(node.tag))) assert.equal(node.props.autocomplete, 'off');
    store.ui({ view: 'board' }); assert(text(App(store.getState(), ctx)).includes('Manual'));
  } finally { store.destroy(); }
});

test('keyboard shortcuts support task actions while leaving typing and modal input alone', () => {
  const calls = [], state = { ui: { editing: { id: 'task' }, tagsOpen: false, confirmation: null } };
  const ctx = { store: { getState: () => state } };
  for (const method of ['focusSearch', 'createTask', 'toggleView', 'openTags', 'resetOrder', 'tryFlush', 'toggleCurrentTask', 'closeEditor', 'deleteTask', 'openHelp', 'closeHelp']) ctx[method] = () => calls.push(method);
  const event = (key, props = {}) => ({ key, target: { closest: () => false }, preventDefault() { this.defaultPrevented = true; }, ...props });
  for (const [key, method] of [['n', 'createTask'], ['/', 'focusSearch'], ['v', 'toggleView'], ['t', 'openTags'], ['m', 'resetOrder'], ['Delete', 'deleteTask'], ['Escape', 'closeEditor'], ['?', 'openHelp']]) {
    const input = event(key); assert(handleShortcut(input, ctx)); assert.equal(calls.at(-1), method); assert(input.defaultPrevented);
  }
  const typing = { closest: () => true };
  assert(!handleShortcut(event('n', { target: typing }), ctx));
  assert(!handleShortcut(event('Delete', { target: typing }), ctx));
  assert(!handleShortcut(event('?', { target: typing }), ctx));
  for (const [key, modifiers, method] of [['k', { ctrlKey: true }, 'focusSearch'], ['a', { metaKey: true, shiftKey: true }, 'createTask'], ['s', { ctrlKey: true }, 'tryFlush'], ['Enter', { metaKey: true }, 'toggleCurrentTask']]) {
    assert(handleShortcut(event(key, { ...modifiers, target: typing }), ctx)); assert.equal(calls.at(-1), method);
  }
  assert(!handleShortcut(event('n', { isComposing: true }), ctx));
  assert(!handleShortcut(event('n', { repeat: true }), ctx));
  state.ui.tagsOpen = true; assert(!handleShortcut(event('n'), ctx));
  state.ui.tagsOpen = false; state.ui.confirmation = {}; assert(!handleShortcut(event('Delete'), ctx));
  state.ui.confirmation = null; state.ui.helpOpen = true;
  assert(!handleShortcut(event('n'), ctx));
  assert(handleShortcut(event('Escape'), ctx)); assert.equal(calls.at(-1), 'closeHelp');
});

test('custom tag colors normalize safely and survive backup and reload', async () => {
  const data = sample(), id = saveTag(data, { name: 'Custom', color: '#F0A' });
  assert.equal(data.tags.find(tag => tag.id === id).color, '#ff00aa');
  assert.equal(normalizeColor('#ABCDEF'), '#abcdef');
  assert.throws(() => normalizeColor('#fff; background:url(bad)'), /hex color/);
  assert.throws(() => normalizeColor('red'), /hex color/);
  for (const color of ['#ffffff', '#000000', '#ffed00', '#00ff8a']) {
    const style = tagAppearance(color);
    assert.equal(style['--tag-color'], color);
    assert(/^#[\da-f]{6}$/.test(style['--tag-text']));
    assert.notEqual(style['--tag-text'], style['--tag-soft']);
  }
  const restored = await readBackup(await createBackup(data, {}));
  assert.equal(restored.data.tags.find(tag => tag.id === id).color, '#ff00aa');
});

test('board movement is immediate, includes completed cards, and confirms completion only after saving', async () => {
  const data = sample(), repository = memoryRepository(data), commit = repository.commit;
  let release; const gate = new Promise(resolve => { release = resolve; });
  repository.commit = async (...args) => { await gate; return commit(...args); };
  const store = createStore(repository, { data, revision: 0 }), completed = [];
  const actions = createStatusActions(store, { onComplete: id => completed.push(id) }), id = data.tasks[0].id;
  const nodes = node => [node, ...node.children.flatMap(nodes)];
  try {
    store.ui({ view: 'board', status: 'active' });
    const saving = actions.change(id, 'done');
    assert.equal(store.getState().data.tasks[0].status, 'open');
    assert.equal(displayData(store.getState()).tasks[0].status, 'done');
    const tree = App(store.getState(), { store, getDraft: () => null });
    const doneColumn = nodes(tree).find(node => node.props.class === 'board-column' && node.props['aria-label'] === 'Completed');
    assert(nodes(doneColumn).some(node => node.props['data-task-id'] === id));
    assert.equal(completed.length, 0);
    release(); await saving;
    assert.equal(store.getState().data.tasks[0].status, 'done');
    assert.deepEqual(completed, [id]); assert.deepEqual(store.getState().ui.pendingStatuses, {});
    await actions.change(id, 'open'); assert.equal(completed.length, 1);
  } finally { release(); store.destroy(); }
});

test('failed board moves roll back without playing completion feedback', async () => {
  const data = sample(), repository = memoryRepository(data);
  repository.commit = async () => { throw new Error('Storage full'); };
  const store = createStore(repository, { data, revision: 0 });
  let celebrations = 0; const actions = createStatusActions(store, { onComplete: () => celebrations++ });
  try {
    const change = actions.change(data.tasks[0].id, 'done');
    assert.equal(displayData(store.getState()).tasks[0].status, 'done');
    await assert.rejects(change, /Storage full/);
    assert.equal(displayData(store.getState()).tasks[0].status, 'open');
    assert.deepEqual(store.getState().ui.pendingStatuses, {}); assert.equal(celebrations, 0);
  } finally { store.destroy(); }
});

test('rapid status changes keep the latest move visible until its write commits', async () => {
  const data = sample(), repository = memoryRepository(data), commit = repository.commit;
  let release; const gate = new Promise(resolve => { release = resolve; });
  repository.commit = async (...args) => { await gate; return commit(...args); };
  const store = createStore(repository, { data, revision: 0 });
  let celebrations = 0; const actions = createStatusActions(store, { onComplete: () => celebrations++ });
  try {
    const first = actions.change(data.tasks[0].id, 'done');
    const second = actions.change(data.tasks[0].id, 'in_progress');
    assert.equal(displayData(store.getState()).tasks[0].status, 'in_progress');
    release(); await Promise.all([first, second]);
    assert.equal(store.getState().data.tasks[0].status, 'in_progress');
    assert.equal(celebrations, 0); assert.deepEqual(store.getState().ui.pendingStatuses, {});
  } finally { release(); store.destroy(); }
});

test('status changes from the open task save its notes and update the board together', async () => {
  const data = sample(), store = createStore(memoryRepository(data), { data, revision: 0 });
  const session = createTaskSession(data.tasks[0], store, { delay: 100000 });
  const actions = createStatusActions(store, { getSession: () => session });
  try {
    session.change({ document: documentFromText('Unsaved notes') });
    const change = actions.change(session.id, 'done');
    assert.equal(displayData(store.getState()).tasks[0].status, 'done');
    await change;
    assert.equal(store.getState().data.tasks[0].description, 'Unsaved notes');
    assert.equal(store.getState().data.tasks[0].status, 'done'); assert.equal(session.dirty, false);
  } finally { session.dispose(); store.destroy(); }
});

test('frontend uses local static assets and same-origin sync without a Node server', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert(!manifest.scripts.start);
  assert(!/rel="(?:icon|manifest)"|(?:src|href)="https?:\/\//.test(html));
  assert(html.includes("connect-src 'self';"));
  assert(html.includes('js/main.js') && html.includes('css/components.css'));
  await assert.rejects(readFile(new URL('../server.mjs', import.meta.url)));
});
