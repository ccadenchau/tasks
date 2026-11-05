import { h } from './dom.js';
import { visibleTasks } from './model.js';
import { button, formatDate, iconButton, input, localDate } from './controls.js';
import { tagChip, TagManager, TagViews } from './tags.js';
import { tagAppearance } from './tag-colors.js';
import { mountTabTrack } from './layout.js';
import { displayData } from './status-actions.js';
import { TaskPanel } from './task-panel.js';
import { Confirmation } from './dialogs.js';
import { ShortcutHelp } from './help.js';
import { celebrateCompletion } from './completion.js';

export function App(state, ctx) {
  const data = displayData(state);
  const tasks = visibleTasks(data, { ...state.ui, status: ['board', 'tag-board', 'calendar'].includes(state.ui.view) || state.ui.query.trim() ? 'all' : state.ui.status });
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
          h('div', { class: 'view-switcher', role: 'group', 'aria-label': 'Task view' }, [['list', 'List', 'List view: tasks in rows'], ['board', 'Board', 'Board view: tasks grouped by status'], ['calendar', 'Calendar', 'Calendar view: tasks by due date'], ['scheduled', 'Scheduled', 'Scheduled view: daily goals that expire each day']].map(([view, label, description]) => {
            const selected = state.ui.view === view || view === 'board' && state.ui.view === 'tag-board';
            const paths = { list: ['M4 6h16M4 12h16M4 18h16', 'M2 6h.01M2 12h.01M2 18h.01'], board: ['M4 5h6v14H4zM14 5h6v14h-6z'], calendar: ['M4 5h16v15H4zM8 3v4M16 3v4M4 10h16'], scheduled: ['M4 7h16M7 4v6m10-6v6M6 13h3m3 0h3m-9 4h3m3 0h3', 'M19 16v5m-2.5-2.5h5'] }[view];
            return button([h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, paths.map(d => h('path', { d }))), h('span', { class: 'custom-tooltip', id: `view-tip-${view}`, role: 'tooltip' }, description)], () => ctx.setView(view), { class: `view-option tooltip-anchor ${selected ? 'selected' : ''}`, 'aria-label': description, 'aria-describedby': `view-tip-${view}`, 'aria-pressed': String(selected), key: view });
          })),
        ),
        h('div', { class: 'view-toolbar', key: 'view-toolbar', 'data-keep-panel': '' },
          ['board', 'tag-board'].includes(state.ui.view) ? h('div', { class: 'ordering-bar' }, button('Manual', ctx.resetOrder, { class: `order-button ${state.ui.sort === 'manual' ? 'selected' : ''}`, title: 'Use drag order (M)', 'aria-keyshortcuts': 'm', 'aria-pressed': String(state.ui.sort === 'manual') }), [['title', 'Name'], ['due', 'Due'], ['created', 'Created']].map(([key, label]) => SortButton(state, ctx, key, label))) : !['calendar', 'scheduled'].includes(state.ui.view) && h('div', { class: 'status-tabs', role: 'group', 'aria-label': 'Show tasks', onMount: mountTabTrack, onUnmount: node => node.disposeLayout?.() }, [['active', 'Active'], ['all', 'All'], ['done', 'Completed']].map(([value, label]) => button([label, h('span', { class: 'count' }, statusCounts[value])], () => ctx.changeStatusFilter(value), { class: `status-tab ${state.ui.status === value ? 'selected' : ''}`, 'aria-pressed': String(state.ui.status === value), key: value }))),
          ['board', 'tag-board'].includes(state.ui.view) && state.data.tags.length > 0 && button(state.ui.view === 'tag-board' ? 'Status boards' : 'Boards by tag', ctx.toggleBoardMode, { class: 'text-button board-mode-toggle', 'aria-pressed': String(state.ui.view === 'tag-board') }),
        ),
        h('div', { class: `task-content ${state.ui.view === 'tag-board' ? 'is-tag-board' : ''}`, key: 'task-content' }, ['board', 'tag-board'].includes(state.ui.view) ? Board(state, ctx, tasks, state.ui.view === 'tag-board') : state.ui.view === 'calendar' ? Calendar(state, ctx, tasks) : state.ui.view === 'scheduled' ? ScheduledView(state, ctx) : TaskTable(state, ctx, tasks.slice(0, state.ui.limit)), !tasks.length && !['calendar', 'scheduled'].includes(state.ui.view) && !['board', 'tag-board'].includes(state.ui.view) && h('p', { class: 'empty' }, state.ui.query ? 'No matches' : 'No tasks'), hasMore && button('Show more', () => ctx.store.ui({ limit: state.ui.limit + 100 }), { class: 'button show-more' })),
        h('footer', { class: 'pane-footer' }, h('span', {}, state.ui.view === 'scheduled' ? `${state.data.scheduledTasks.length} daily ${state.data.scheduledTasks.length === 1 ? 'goal' : 'goals'}` : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`), state.ui.syncStatus && button(h('span', { 'aria-hidden': 'true' }, '●'), ctx.syncNow, { class: `sync-indicator sync-indicator--${state.ui.syncStatus.kind}`, title: state.ui.syncStatus.title, 'aria-label': state.ui.syncStatus.title })),
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
  return h('div', { class: 'task-name' }, checkbox(task, ctx), h('div', { class: 'task-summary' }, button([task.parentTaskId && h('span', { class: 'subtask-marker', 'aria-hidden': 'true' }, '↳ '), task.title], () => ctx.edit(task.id), { class: `task-title ${task.status === 'done' ? 'is-done' : ''}`, 'data-open-task': '', title: 'Open task.' }), state.ui.view !== 'tag-board' && !task.parentTaskId && TaskTags(state, ctx, task)));
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

function Calendar(state, ctx, tasks) {
  const dated = tasks.filter(task => task.dueAt).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.position - b.position);
  const now = new Date(), [year, monthNumber] = (state.ui.calendarMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
  const monthTasks = dated.filter(task => task.dueAt.startsWith(month));
  const firstDay = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const byDay = new Map();
  for (const task of monthTasks) {
    const day = Number(task.dueAt.slice(8, 10));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(task);
  }
  const monthDate = new Date(year, monthNumber - 1, 1);
  const shiftMonth = amount => {
    const shifted = new Date(year, monthNumber - 1 + amount, 1);
    ctx.store.ui({ calendarMonth: `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`, calendarMonthDirection: amount > 0 ? 'next' : 'previous' });
  };
  return h('div', { class: 'calendar-view', 'aria-label': 'Tasks by due date' },
    h('section', { class: 'calendar-month', key: month, 'aria-label': monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), 'data-month-direction': state.ui.calendarMonthDirection || 'next' },
      h('header', { class: 'calendar-month-header' }, h('div', { class: 'calendar-month-title' }, h('h2', {}, monthDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })), h('span', { class: 'calendar-month-count' }, `${monthTasks.length} ${monthTasks.length === 1 ? 'task' : 'tasks'}`)), h('div', { class: 'calendar-month-controls' }, button('‹', () => shiftMonth(-1), { class: 'calendar-nav', title: 'Previous month', 'aria-label': 'Previous month' }), button('Today', () => { const today = new Date(); ctx.store.ui({ calendarMonth: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}` }); }, { class: 'calendar-today', title: 'Go to current month' }), button('›', () => shiftMonth(1), { class: 'calendar-nav', title: 'Next month', 'aria-label': 'Next month' }))),
      h('div', { class: 'calendar-grid' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => h('div', { class: 'calendar-weekday', key: day }, day)),
        Array.from({ length: firstDay }, (_, index) => h('div', { class: 'calendar-day calendar-day--empty', key: `empty-${index}` })),
        Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const entries = byDay.get(day) || [];
          const date = `${month}-${String(day).padStart(2, '0')}`;
          return h('div', { class: `calendar-day ${date === localDate() ? 'calendar-day--today' : ''}`, key: date }, h('span', { class: 'calendar-day-number' }, String(day)), entries.map(task => {
            const tag = task.tagIds.map(id => state.data.tags.find(item => item.id === id)).find(Boolean);
            const color = tag ? tagAppearance(tag.color)['--tag-color'] : '#94a3b8';
            return button([h('span', { class: `calendar-task-dot ${task.status === 'done' ? 'is-done' : ''} ${date < localDate() && task.status !== 'done' ? 'overdue' : ''}` }), h('span', {}, task.title)], () => ctx.edit(task.id), { class: `calendar-task ${task.status === 'done' ? 'is-done' : ''} ${date < localDate() && task.status !== 'done' ? 'overdue' : ''}`, css: { '--calendar-task-color': color }, title: tag ? `${task.title} · ${tag.name}` : task.title, 'data-open-task': '', key: task.id });
          }));
        }),
      ),
    ),
  );
}

function ScheduledView(state, ctx) {
  const today = localDate();
  const todayTasks = state.data.scheduledTasks.map(task => ({ ...task, todayCount: task.progress.find(item => item.date === today)?.count || 0, stats: scheduledStats(task) }));
  const cards = todayTasks.map(task => h('article', { class: `scheduled-card ${task.todayCount >= task.target ? 'is-complete' : ''}`, key: task.id, 'data-task-id': task.id },
    h('div', { class: 'scheduled-card-main' },
      h('h3', {}, task.title),
      h('span', { class: 'scheduled-progress' }, task.todayCount >= task.target ? 'Complete for today' : `${task.todayCount} of ${task.target} complete today`),
      h('div', { class: 'scheduled-checklist', role: 'group', 'aria-label': `Complete ${task.title}` }, Array.from({ length: task.target }, (_, index) => {
        const completed = index < task.todayCount;
        return button(completed ? '✓' : '', async event => {
          const anchor = event.currentTarget.getBoundingClientRect();
          try {
            await ctx.updateScheduledProgress(task.id, today, completed ? -1 : 1);
            if (!completed) celebrateCompletion(task.id, anchor);
          } catch (error) { ctx.showError(error); }
        }, { class: `scheduled-check ${completed ? 'is-complete' : ''}`, title: `${completed ? 'Uncheck' : 'Complete'} item ${index + 1}`, 'aria-label': `${completed ? 'Uncheck' : 'Complete'} item ${index + 1} for ${task.title}`, 'aria-pressed': String(completed), key: index });
      })),
    ),
    h('div', { class: 'scheduled-actions' },
      h('span', { class: 'scheduled-stats-anchor tooltip-anchor', tabindex: 0, 'aria-label': `Statistics for ${task.title}` },
        h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, h('path', { d: 'M4 19V5m0 14h16M8 15v-4m4 4V7m4 8V9' })),
        h('span', { class: 'scheduled-stats-card', role: 'tooltip' },
          h('strong', {}, 'Goal statistics'),
          h('div', { class: 'scheduled-stats-grid' },
            stat('Total completed', task.stats.total), stat('Days completed', task.stats.days), stat('Current streak', `${task.stats.current} days`), stat('Best streak', `${task.stats.best} days`),
          ),
        ),
      ),
      iconButton('trash', `Delete ${task.title}`, () => ctx.deleteScheduledTask(task.id), { class: 'icon-button scheduled-delete' }),
    ),
  ));
  return h('div', { class: 'scheduled-view' },
    h('header', { class: 'scheduled-heading' }, h('div', {}, h('h2', {}, 'Daily goals'), h('p', {}, 'These goals reset each day. Missed days expire automatically.'))),
    h('form', { class: 'scheduled-create', onSubmit: async event => {
      event.preventDefault(); const form = event.currentTarget, title = form.elements.title.value, target = Number(form.elements.target.value);
      try { await ctx.addScheduledTask(title, target); form.reset(); form.elements.title.focus(); } catch (error) { ctx.showError(error); }
    } }, input('scheduled-title', '', { name: 'title', placeholder: 'e.g. Apply to internships', 'aria-label': 'Daily goal', required: true, maxlength: 1000 }), input('scheduled-target', '5', { name: 'target', type: 'number', min: 1, max: 100, 'aria-label': 'Daily target', required: true }), h('button', { class: 'button button--primary', type: 'submit', disabled: state.saving }, 'Add daily goal')),
    todayTasks.length ? h('div', { class: 'scheduled-list' }, cards) : h('p', { class: 'scheduled-empty' }, 'Add a daily goal to start tracking a repeating routine.'),
  );
}

function stat(label, value) {
  return h('div', { class: 'scheduled-stat' }, h('strong', {}, String(value)), h('span', {}, label));
}

function scheduledStats(task) {
  const total = task.progress.reduce((sum, item) => sum + item.count, 0);
  const completed = task.progress.filter(item => item.count >= task.target).map(item => item.date).sort();
  const days = completed.length;
  let best = 0, run = 0, previous = null;
  for (const value of completed) {
    const current = new Date(`${value}T12:00:00Z`);
    const gap = previous ? (current - previous) / 86400000 : 0;
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run); previous = current;
  }
  let current = 0, cursor = completed.length - 1;
  if (completed.at(-1) !== dateOffset(0) && completed.at(-1) !== dateOffset(-1)) return { total, days, current, best };
  let offset = completed.at(-1) === dateOffset(0) ? 0 : -1;
  while (cursor >= 0) {
    if (completed[cursor] !== dateOffset(offset)) break;
    current++; cursor--; offset--;
  }
  return { total, days, current, best };
}

function dateOffset(offset) {
  const [year, month, day] = localDate().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
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
