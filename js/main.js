import { openRepository } from './repository.js';
import { createStore } from './store.js';
import { createTaskSession } from './task-session.js';
import { addSubtask, removeTask, deleteTag, migrateDocuments, newTask, saveTag, uid, validateData } from './model.js';
import { createStatusActions } from './status-actions.js';
import { celebrateCompletion } from './completion.js';
import { documentFromText } from './document.js';
import { mountInlineMarkdownEditor } from './inline-markdown.js';
import { attachPanelResize, clampPanelWidth } from './panel-resize.js';
import { createBackup, download, readBackup } from './backup.js';
import { mount } from './dom.js';
import { App } from './ui.js';
import { handleShortcut } from './shortcuts.js';
import { startCloudSync } from './sync.js';
import { createContentTransition } from './transitions.js';
import { clearRememberedLogin, signIn } from './sign-in.js';

const root = document.querySelector('#app');

async function start() {
  await removeOldOfflineCache();
  const api = await signIn(root);
  const repository = await openRepository();
  let initial = await repository.load();
  validateData(initial.data);
  const migrated = structuredClone(initial.data);
  if (migrateDocuments(migrated)) { validateData(migrated); const revision = await repository.commit(initial.data, migrated, initial.revision); initial = { data: migrated, revision }; }
  if (!initial.sync) { await repository.commit(initial.data, initial.data, initial.revision); initial = await repository.load(); }
  const store = createStore(repository, initial);
  const cloud = startCloudSync(store, repository, { api });
  let active = null, returnFocus = null, tagReturnFocus = null, confirmationFocus = null, helpReturnFocus = null;
  try { store.ui({ panelWidth: clampPanelWidth(localStorage.getItem('checklist-panel-width') || 460, innerWidth) }); } catch {}
  const statuses = createStatusActions(store, { getSession: () => active, onComplete: celebrateCompletion });

  function editState(status, error = '') { store.ui({ editStatus: status, editError: error }); }
  const flushTask = () => active?.flush() || Promise.resolve();
  const transitionContent = createContentTransition(() => document.querySelector('.list-pane > .task-content'), () => app.flush());
  const updateView = patch => transitionContent(() => store.ui(patch));

  const ctx = {
    store,
    syncNow: () => cloud.request(),
    signOut() { ctx.attempt(async () => { await flushTask(); await store.whenIdle(); cloud.stop(); api.signOut(); clearRememberedLogin(); location.reload(); }); },
    openHelp(event) { helpReturnFocus = event?.currentTarget || document.activeElement; store.ui({ helpOpen: true }); },
    closeHelp() { store.ui({ helpOpen: false }); requestAnimationFrame(() => { if (helpReturnFocus?.isConnected) helpReturnFocus.focus(); }); },
    showError(error) { store.error(error.message); },
    async attempt(action) { try { await action(); } catch (error) { ctx.showError(error); } },
    getDraft: () => active?.draft,
    focusSearch() { const search = document.querySelector('#search'); search?.focus(); search?.select(); },
    toggleCurrentTask() { if (active) ctx.attempt(() => ctx.changeStatus(active.id, active.draft.status === 'done' ? 'open' : 'done')); },
    search(query) { store.ui({ query, limit: 100, ...(query.trim() ? { status: 'all' } : {}) }); },
    sortBy(sort) { const ui = store.getState().ui; updateView({ sort, direction: ui.sort === sort && ui.direction === 'asc' ? 'desc' : 'asc' }); },
    resetOrder() { updateView({ sort: 'manual', direction: 'asc' }); },
    changeStatusFilter(status) { if (store.getState().ui.status !== status) updateView({ status, limit: 100 }); },
    toggleView() { updateView({ view: store.getState().ui.view === 'board' ? 'list' : 'board', limit: 100 }); },
    async addTask(title) {
      const tagIds = [...store.getState().ui.tagIds];
      let id;
      await store.mutate(data => { const task = { ...newTask(title, Math.max(-1, ...data.tasks.map(task => task.position)) + 1), tagIds }; id = task.id; data.tasks.push(task); });
      store.ui({ status: 'active', query: '', limit: 100 }); return id;
    },
    createTask() { ctx.attempt(async () => { await flushTask(); const id = await ctx.addTask('Untitled task'); await ctx.edit(id, true); }); },
    async createSubtask(parentId, title) { await store.mutate(data => { addSubtask(data, parentId, title); }); },
    mainPanelClick(event) {
      if (!active || event.target.closest('[data-open-task], [data-keep-panel]')) return;
      ctx.closeEditor();
    },
    mountDivider(node) {
      queueMicrotask(() => {
        if (!node.isConnected) return;
        const panelWidth = clampPanelWidth(store.getState().ui.panelWidth, node.parentElement.getBoundingClientRect().width);
        if (panelWidth !== store.getState().ui.panelWidth) store.ui({ panelWidth });
        node.detachResize = attachPanelResize(node, { onChange: panelWidth => store.ui({ panelWidth }), onFinish: () => { try { localStorage.setItem('checklist-panel-width', store.getState().ui.panelWidth); } catch {} } });
      });
    },
    async toggleTask(id, checkbox) {
      const task = store.getState().data.tasks.find(task => task.id === id);
      if (!task) return;
      const status = checkbox ? checkbox.checked ? 'done' : 'open' : task.status === 'done' ? 'open' : 'done';
      try { await ctx.changeStatus(id, status, checkbox?.getBoundingClientRect()); }
      catch (error) { if (checkbox) checkbox.checked = store.getState().data.tasks.find(task => task.id === id)?.status === 'done'; ctx.showError(error); }
    },
    async changeStatus(id, status, anchor) {
      try {
        const item = [...document.querySelectorAll('[data-task-id]')].find(node => node.dataset.taskId === id);
        await statuses.change(id, status, anchor || item?.getBoundingClientRect());
      } catch (error) { ctx.showError(error); throw error; }
    },
    reorder(id, targetId) {
      ctx.attempt(async () => {
        await flushTask();
        await store.mutate(data => {
          const task = data.tasks.find(task => task.id === id), ordered = data.tasks.filter(task => task.id !== id).sort((a, b) => a.position - b.position), index = ordered.findIndex(task => task.id === targetId);
          if (!task || index < 0) return;
          ordered.splice(index, 0, task); ordered.forEach((task, index) => { task.position = index; });
        });
      });
    },
    async edit(id, focusTitle = false) {
      if (active?.id === id) { await ctx.closeEditor(); return; }
      try { await flushTask(); } catch { return; }
      const task = store.getState().data.tasks.find(task => task.id === id);
      if (!task) return;
      if (!active) returnFocus = document.activeElement;
      active?.dispose();
      const session = createTaskSession(task, store, { onStatus: (status, error) => { if (active === session) editState(status, error); } });
      active = session;
      store.ui({ editing: { id }, panelClosing: false, focusTitle, editStatus: 'Saved', editError: '', tagQuery: '', tagSearchOpen: false });
    },
    async closeEditor() {
      const session = active;
      if (!session || session.closing) return;
      session.closing = true;
      try { await flushTask(); } catch (error) { session.closing = false; editState('Save failed', error.message); return; }
      if (active !== session) return;
      store.ui({ panelClosing: true });
      const panel = document.querySelector('.task-panel');
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && panel?.animate) await panel.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(40px)', opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
      if (active !== session) return;
      session.dispose(); active = null;
      store.ui({ editing: null, panelClosing: false, editError: '' }); requestAnimationFrame(() => (returnFocus?.isConnected ? returnFocus : document.querySelector('#main'))?.focus());
    },
    discardEditor() {
      if (!confirm('Discard unsaved changes?')) return;
      active?.dispose(); active = null; store.ui({ editing: null, editError: '' });
    },
    changeTask(fields) {
      active?.change(fields);
    },
    async tryFlush() {
      try { await flushTask(); } catch (error) { if (active) editState('Save failed', error.message); }
    },
    mountNotes(node, id) {
      if (active?.id !== id) return;
      const api = mountInlineMarkdownEditor(node, { value: active.draft.markdown || '', onChange: markdown => { if (active?.id === id) ctx.changeTask({ markdown, document: documentFromText(markdown), description: markdown }); }, onError: error => { if (active?.id === id) active.invalid(error); } });
      node.notesEditor = api; active.api = api;
    },
    unmountNotes(node) { if (active?.api === node.notesEditor) active.api = null; node.notesEditor?.destroy(); },
    toggleTag(id) {
      if (!active) return;
      ctx.changeTask({ tagIds: active.draft.tagIds.includes(id) ? active.draft.tagIds.filter(tagId => tagId !== id) : [...active.draft.tagIds, id] }); ctx.tryFlush();
    },
    openTags(taskId = null) { tagReturnFocus = document.activeElement; store.ui({ tagsOpen: true, tagEdit: null, tagFormKey: uid(), tagTarget: taskId, tagSearchOpen: false }); },
    closeTags() { store.ui({ tagsOpen: false }); requestAnimationFrame(() => tagReturnFocus?.isConnected && tagReturnFocus.focus()); },
    selectTag(id) { store.ui({ tagEdit: id, tagFormKey: uid() }); },
    async viewTag(id) { await ctx.closeEditor(); updateView({ tagIds: id ? [id] : [], query: '', status: 'all', limit: 100 }); },
    async saveTag(fields) {
      let id;
      await store.mutate(data => { id = saveTag(data, fields); });
      const target = store.getState().ui.tagTarget;
      if (!fields.id && active?.id === target) { ctx.changeTask({ tagIds: [...new Set([...active.draft.tagIds, id])] }); await flushTask(); }
      store.ui({ tagEdit: id, tagFormKey: uid() });
    },
    deleteTag(id) {
      ctx.askConfirmation({ title: 'Delete tag?', message: 'Tasks will be kept.', action: async () => {
        await flushTask(); await store.mutate(data => deleteTag(data, id));
        store.ui({ tagEdit: null, tagFormKey: uid(), tagIds: store.getState().ui.tagIds.filter(tagId => tagId !== id) });
      } });
    },
    deleteTask(id) {
      const files = store.getState().data.attachments.filter(file => file.ownerType === 'task' && file.ownerId === id);
      const children = store.getState().data.tasks.some(task => task.parentTaskId === id);
      ctx.askConfirmation({ title: 'Delete task?', message: `${files.length ? 'Its attached files will also be deleted.' : 'This task will be deleted.'}${children ? ' Subtasks will be kept as separate tasks.' : ''}`, action: async () => {
        await flushTask();
        await store.mutate(data => removeTask(data, id));
        if (active?.id === id) await ctx.closeEditor();
      } });
    },
    askConfirmation(confirmation) { confirmationFocus = document.activeElement; store.ui({ confirmation: { ...confirmation, key: uid() } }); },
    closeConfirmation() { store.ui({ confirmation: null }); requestAnimationFrame(() => { if (confirmationFocus?.isConnected) confirmationFocus.focus(); }); },
    downloadFile(file) { ctx.attempt(async () => { const blob = await repository.getBlob(file.id); if (!blob) throw new Error('File not found.'); download(blob, file.name); }); },
    exportData() { document.querySelector('.menu')?.removeAttribute('open'); ctx.attempt(async () => { await flushTask(); await store.whenIdle(); download(await createBackup(store.getState().data, repository), `tasks-${new Date().toISOString().slice(0, 10)}.json`); }); },
    importData() {
      document.querySelector('.menu')?.removeAttribute('open');
      const input = document.createElement('input'); input.type = 'file'; input.autocomplete = 'off'; input.accept = '.json,application/json';
      input.onchange = () => ctx.attempt(async () => {
        if (!input.files[0]) return;
        await flushTask(); const backup = await readBackup(input.files[0]); migrateDocuments(backup.data); validateData(backup.data);
        if (!confirm('Replace all tasks with this backup?')) return;
        await store.replace(backup.data, backup.blobs); active?.dispose(); active = null;
        store.ui({ query: '', editing: null, tagIds: [], tagsOpen: false, limit: 100 });
      }); input.click();
    },
  };

  root.replaceChildren();
  const app = mount(root, () => App(store.getState(), ctx));
  store.subscribe(state => {
    if (active && !active.dirty && !active.saving) {
      const task = state.data.tasks.find(task => task.id === active.id);
      if (task && JSON.stringify(task) !== JSON.stringify(active.base)) {
        const notesChanged = task.markdown !== active.base.markdown;
        active.base = structuredClone(task); active.draft = structuredClone(task);
        if (notesChanged) active.api?.setValue(task.markdown || '');
      }
    }
    app.schedule();
  });
  window.addEventListener('database-blocked', () => ctx.showError(new Error('Close other app tabs, then reload.')));
  window.addEventListener('beforeunload', event => { if (store.getState().saving || active?.dirty) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ctx.tryFlush(); });
  document.addEventListener('keydown', event => handleShortcut(event, ctx));
}

async function removeOldOfflineCache() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const script = new URL('sw.js', location.href).href;
    for (const registration of await navigator.serviceWorker.getRegistrations()) if ([registration.active, registration.waiting, registration.installing].some(worker => worker?.scriptURL === script)) await registration.unregister();
    for (const name of await caches.keys()) if (name.startsWith('taskspace-shell-')) await caches.delete(name);
  } catch { /* Old caches never contain canonical task data. */ }
}

start().catch(error => { root.replaceChildren(); const message = document.createElement('p'); message.className = 'error'; message.textContent = error.message; root.append(message); });
