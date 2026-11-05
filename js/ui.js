import { h } from './dom.js';
import { visibleTasks } from './model.js';
import { button, formatDate, input, localDate } from './controls.js';
import { tagChip, TagManager, TagViews } from './tags.js';
import { tagAppearance } from './tag-colors.js';
import { mountTabTrack } from './layout.js';
import { displayData } from './status-actions.js';
import { TaskPanel } from './task-panel.js';
import { Confirmation } from './dialogs.js';
import { ShortcutHelp } from './help.js';

export function App(state, ctx) {
  const data = displayData(state);
  const tasks = visibleTasks(data, { ...state.ui, status: ['board', 'tag-board'].includes(state.ui.view) || state.ui.query.trim() ? 'all' : state.ui.status });
  const all = visibleTasks(data, { ...state.ui, status: 'all' });
  const hasMore = ['board', 'tag-board'].includes(state.ui.view) ? tasks.length > state.ui.limit : tasks.length > state.ui.limit;
  const statusCounts = { all: all.length, active: all.filter(task => task.status !== 'done').length, done: all.filter(task => task.status === 'done').length };
  return h('div', { class: 'app' },
    h('header', { class: 'toolbar', key: 'toolbar' }, button(h('span', { 'aria-hidden': 'true' }, '?'), ctx.openHelp, { class: 'icon-button help-button', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', 'aria-haspopup': 'dialog', 'aria-expanded': String(Boolean(state.ui.helpOpen)), 'aria-keyshortcuts': '?' }), Search(state, ctx),
      h('div', { class: 'actions' }, button('Tags', () => ctx.openTags(), { title: 'Edit tags (T)', 'aria-keyshortcuts': 't', 'aria-haspopup': 'dialog', 'aria-expanded': String(state.ui.tagsOpen) }),
        h('details', { class: 'menu', key: 'data-menu' }, h('summary', { class: 'button' }, 'Data'), h('div', { class: 'menu-items' }, button('Export', ctx.exportData, { title: 'Download a backup including task notes and files.' }), button('Import', ctx.importData, { title: 'Replace data from a backup.' }), button('Sign out', ctx.signOut))),
      ),
    ),
    state.error && h('p', { class: 'error error-banner', key: 'storage-error', role: 'alert' }, state.error),
    h('div', { class: `panes ${state.ui.editing ? 'has-task-panel' : ''} ${state.ui.panelClosing ? 'is-panel-closing' : ''}`, key: 'panes', css: { '--panel-width': `${state.ui.panelWidth || 460}px` } },
      h('main', { class: 'list-pane', id: 'main', 'aria-label': 'Tasks', tabindex: '-1', onClick: ctx.mainPanelClick },
        h('div', { class: 'views-header', key: 'views-header', 'data-keep-panel': '' }, TagViews(state, ctx),
          button(state.ui.view === 'board' || state.ui.view === 'tag-board' ? 'List view' : 'Board view', ctx.toggleView, { class: 'text-button view-toggle', title: state.ui.view === 'board' || state.ui.view === 'tag-board' ? 'Switch to list view (V)' : 'Switch to board view (V)', 'aria-keyshortcuts': 'v' }),
        ),
        h('div', { class: 'view-toolbar', key: 'view-toolbar', 'data-keep-panel': '' },
          !['board', 'tag-board'].includes(state.ui.view) ? h('div', { class: 'status-tabs', role: 'group', 'aria-label': 'Show tasks', onMount: mountTabTrack, onUnmount: node => node.disposeLayout?.() }, [['active', 'Active'], ['all', 'All'], ['done', 'Completed']].map(([value, label]) => button([label, h('span', { class: 'count' }, statusCounts[value])], () => ctx.changeStatusFilter(value), { class: `status-tab ${state.ui.status === value ? 'selected' : ''}`, 'aria-pressed': String(state.ui.status === value), key: value }))) : h('div', { class: 'ordering-bar' }, button('Manual', ctx.resetOrder, { class: `order-button ${state.ui.sort === 'manual' ? 'selected' : ''}`, title: 'Use drag order (M)', 'aria-keyshortcuts': 'm', 'aria-pressed': String(state.ui.sort === 'manual') }), [['title', 'Name'], ['due', 'Due'], ['created', 'Created']].map(([key, label]) => SortButton(state, ctx, key, label))),
          ['board', 'tag-board'].includes(state.ui.view) && state.data.tags.length > 0 && button(state.ui.view === 'tag-board' ? 'Status boards' : 'Boards by tag', ctx.toggleBoardMode, { class: 'text-button board-mode-toggle', 'aria-pressed': String(state.ui.view === 'tag-board') }),
        ),
        h('div', { class: 'task-content', key: 'task-content' }, ['board', 'tag-board'].includes(state.ui.view) ? Board(state, ctx, tasks, state.ui.view === 'tag-board') : TaskTable(state, ctx, tasks.slice(0, state.ui.limit)), !tasks.length && !['board', 'tag-board'].includes(state.ui.view) && h('p', { class: 'empty' }, state.ui.query ? 'No matches' : 'No tasks'), hasMore && button('Show more', () => ctx.store.ui({ limit: state.ui.limit + 100 }), { class: 'button show-more' })),
        h('footer', { class: 'pane-footer' }, h('span', {}, `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`), state.ui.syncStatus && button(h('span', { 'aria-hidden': 'true' }, '●'), ctx.syncNow, { class: `sync-indicator sync-indicator--${state.ui.syncStatus.kind}`, title: state.ui.syncStatus.title, 'aria-label': state.ui.syncStatus.title })),
        button([h('span', { 'aria-hidden': 'true' }, '+'), 'Add task'], ctx.createTask, { class: 'button button--primary add-task-fab', title: 'Add task (N or ⌘/Ctrl+Shift+A)', 'aria-keyshortcuts': 'n Control+Shift+A Meta+Shift+A', 'data-keep-panel': '', disabled: state.saving }),
      ),
      state.ui.editing && h('div', { class: 'panel-divider', role: 'separator', 'aria-label': 'Resize task panel', 'aria-orientation': 'vertical', 'aria-valuemin': 260, 'aria-valuenow': state.ui.panelWidth || 460, tabindex: 0, onMount: node => ctx.mountDivider(node), onUnmount: node => node.detachResize?.() }),
      state.ui.editing && TaskPanel(state, ctx),
    ),
    state.ui.tagsOpen && TagManager(state, ctx),
    state.ui.confirmation && Confirmation(state, ctx),
    state.ui.helpOpen && ShortcutHelp(ctx),
  );
}

function SortButton(state, ctx, key, label) {
  const manual = state.ui.sort === 'manual' && key === 'title', selected = state.ui.sort === key;
  return button([label, (selected || manual) && h('span', { 'aria-hidden': 'true' }, manual ? ' ↕' : state.ui.direction === 'asc' ? ' ↑' : ' ↓')], () => ctx.sortBy(key), { class: `sort-button ${selected || manual ? 'selected' : ''}`, title: manual ? 'Drag order. Click to sort by task name.' : `Sort by ${label.toLowerCase()}${selected ? `, ${state.ui.direction === 'asc' ? 'ascending; click for descending' : 'descending; click for ascending'}` : ''}. M restores drag order.` });
}

function openTaskOnClick(task, ctx) {
  return event => {
    if (event.target.closest('button, input, a, label')) return;
    if (window.getSelection()?.toString()) return;
    ctx.edit(task.id);
  };
}

function checkbox(task, ctx) {
  return h('input', { type: 'checkbox', class: 'task-checkbox', checked: task.status === 'done', 'aria-label': `${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`, onChange: event => ctx.toggleTask(task.id, event.currentTarget) });
}

function Search(state, ctx) {
  const shortcut = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? '⌘ K' : 'Ctrl K';
  return h('div', { class: 'search-field' }, input('search', state.ui.query, { class: 'input search', type: 'search', placeholder: 'Search tasks, notes, and tags', 'aria-label': 'Search tasks and notes', title: 'Search (/ or ⌘/Ctrl+K)', 'aria-keyshortcuts': '/ Control+K Meta+K', preserveWhileFocused: true, onInput: event => ctx.search(event.target.value) }), h('kbd', { class: 'search-shortcut', 'aria-hidden': 'true' }, shortcut));
}

function TaskHeading(state, ctx, task) {
  return h('div', { class: 'task-name' }, checkbox(task, ctx), h('div', { class: 'task-summary' }, button([task.parentTaskId && h('span', { class: 'subtask-marker', 'aria-hidden': 'true' }, '↳ '), task.title], () => ctx.edit(task.id), { class: `task-title ${task.status === 'done' ? 'is-done' : ''}`, 'data-open-task': '', title: 'Open task.' }), !task.parentTaskId && TaskTags(state, ctx, task)));
}

function TaskTable(state, ctx, tasks) {
  const headers = [['title', 'Task'], ['due', 'Due'], ['created', 'Created']];
  const tasksById = new Map(state.data.tasks.map(task => [task.id, task]));
  const childrenByParent = new Map();
  for (const task of tasks) if (task.parentTaskId) {
    const children = childrenByParent.get(task.parentTaskId) || [];
    children.push(task);
    childrenByParent.set(task.parentTaskId, children);
  }
  for (const children of childrenByParent.values()) children.sort((a, b) => a.position - b.position);
  const visibleIds = new Set(tasks.map(task => task.id));
  const rows = [];
  const addTask = (task, depth = 0) => {
    rows.push({ task, depth });
    for (const child of childrenByParent.get(task.id) || []) addTask(child, depth + 1);
  };
  for (const task of tasks) if (!task.parentTaskId || !tasksById.has(task.parentTaskId)) addTask(task);
  return h('table', { class: 'task-table', 'aria-label': 'Task list' },
    h('thead', {}, h('tr', {}, headers.map(([key, label]) => h('th', { scope: 'col', class: `column-${key}`, 'aria-sort': state.ui.sort === key ? state.ui.direction === 'asc' ? 'ascending' : 'descending' : state.ui.sort === 'manual' && key === 'title' ? 'other' : 'none' }, SortButton(state, ctx, key, label))))),
    h('tbody', {}, rows.map(({ task, depth }) => h('tr', { class: `task-row ${depth ? 'task-row--subtask' : ''} ${state.ui.editing?.id === task.id ? 'selected' : ''}`, key: task.id, 'data-task-id': task.id, 'data-open-task': '', onClick: openTaskOnClick(task, ctx), draggable: state.ui.sort === 'manual',
      onDragstart: event => { event.dataTransfer.setData('text/checklist', task.id); event.dataTransfer.effectAllowed = 'move'; },
      onDragover: event => { if (state.ui.sort === 'manual') event.preventDefault(); },
      onDrop: event => { event.preventDefault(); const id = event.dataTransfer.getData('text/checklist'); if (state.ui.sort === 'manual' && id && id !== task.id) ctx.reorder(id, task.id); },
    },
      h('td', { class: 'column-title' }, h('div', { class: depth ? 'task-nested' : '', style: depth ? { marginLeft: `${Math.min(depth, 4) * 20}px` } : {} }, TaskHeading(state, ctx, task))),
      h('td', { class: `column-due ${task.dueAt && task.dueAt < localDate() && task.status !== 'done' ? 'overdue' : ''}` }, h('time', { datetime: task.dueAt }, formatDate(task.dueAt))),
      h('td', { class: 'column-created' }, h('time', { datetime: task.createdAt }, formatDate(task.createdAt))),
    ))),
  );
}

function Board(state, ctx, tasks, byTag = false) {
  const taskById = new Map(state.data.tasks.map(task => [task.id, task]));
  const childrenByParent = new Map();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const children = childrenByParent.get(task.parentTaskId) || [];
    children.push(task);
    childrenByParent.set(task.parentTaskId, children);
  }
  for (const children of childrenByParent.values()) children.sort((a, b) => a.position - b.position);
  const groupedTasks = (columnTasks) => columnTasks.filter(task => !task.parentTaskId || !taskById.has(task.parentTaskId)).map(task => ({ task, children: (childrenByParent.get(task.id) || []).filter(child => !byTag || child.tagIds.some(id => task.tagIds.includes(id))) }));
  const columns = byTag
    ? state.data.tags.map(tag => ({ id: `tag-${tag.id}`, label: tag.name, tasks: tasks.filter(task => task.tagIds.includes(tag.id)), tag }))
    : [['open', 'To do'], ['in_progress', 'In progress'], ['done', 'Completed']].map(([status, label]) => ({ id: `status-${status}`, label, tasks: tasks.filter(task => task.status === status), status }));
  return h('div', { class: 'board', 'aria-label': 'Task board' }, columns.map(column => {
    const { id, label } = column;
    return h('section', { class: column.tag ? 'board-column board-column--tag' : 'board-column', key: id, 'aria-label': label, 'data-tag-board': column.tag?.id, css: column.tag ? { '--tag-soft': tagAppearance(column.tag.color)['--tag-soft'] } : {}, onDragover: event => event.preventDefault(), onDrop: event => { event.preventDefault(); const id = event.dataTransfer.getData('text/checklist'); if (id && column.status) ctx.attempt(() => ctx.changeStatus(id, column.status)); } },
      h('div', { class: 'board-heading' }, h('h2', {}, label), h('span', { class: 'count' }, column.tasks.length)),
      groupedTasks(column.tasks).slice(0, state.ui.limit).map(({ task, children }) => h('article', { class: `task-card ${state.ui.editing?.id === task.id ? 'selected' : ''}`, key: task.id, 'data-task-id': task.id, 'data-open-task': '', onClick: openTaskOnClick(task, ctx), draggable: true, onDragstart: event => { event.dataTransfer.setData('text/checklist', task.id); event.dataTransfer.effectAllowed = 'move'; } }, TaskHeading(state, ctx, task), task.dueAt && h('time', { class: `card-date ${task.dueAt < localDate() && task.status !== 'done' ? 'overdue' : ''}`, datetime: task.dueAt }, formatDate(task.dueAt)), children.map(child => h('div', { class: `task-card-subtask ${state.ui.editing?.id === child.id ? 'selected' : ''}`, key: child.id, 'data-task-id': child.id, onClick: openTaskOnClick(child, ctx) }, TaskHeading(state, ctx, child))))),
      !column.tasks.length && h('p', { class: 'board-empty' }, 'No tasks'),
    );
  }));
}

function TaskTags(state, ctx, task) {
  const tags = task.tagIds.map(id => state.data.tags.find(tag => tag.id === id)).filter(Boolean);
  if (!tags.length) return null;
  return h('div', { class: 'task-tags', key: 'tags', 'aria-label': 'Task tags' }, tags.map(tag => tagChip(tag, () => ctx.viewTag(tag.id))));
}
