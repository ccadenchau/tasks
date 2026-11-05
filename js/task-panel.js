import { h } from './dom.js';
import { button, field, iconButton, input, segmented } from './controls.js';
import { TagPicker } from './tags.js';
import { displayData } from './status-actions.js';

export function TaskPanel(state, ctx) {
  const task = ctx.getDraft();
  if (!task) return null;
  const files = state.data.attachments.filter(file => (file.ownerType === 'task' && file.ownerId === task.id) || (file.ownerType === 'page' && task.pageIds.includes(file.ownerId)));
  const children = displayData(state).tasks.filter(child => child.parentTaskId === task.id && !child.archivedAt).sort((a, b) => a.position - b.position);
  const parent = state.data.tasks.find(parent => parent.id === task.parentTaskId);
  return h('aside', { class: 'task-panel', key: task.id, 'aria-label': 'Task details', onMount: node => queueMicrotask(() => { const title = node.querySelector('[aria-label="Task title"]'); title?.focus(); if (state.ui.focusTitle) title?.select(); }) },
    h('div', { class: 'pane-header', title: 'Click the task list or press Escape to close.' }, parent && button(parent.title, () => ctx.edit(parent.id), { class: 'text-button parent-link' }), iconButton('trash', 'Delete task', () => ctx.deleteTask(task.id), { class: 'icon-button danger', disabled: state.saving })),
    h('div', { class: 'task-panel-scroll' },
      input('task-title', task.title, { class: 'task-detail-title', 'aria-label': 'Task title', maxlength: 1000, preserveWhileFocused: true, onInput: event => ctx.changeTask({ title: event.target.value }), onBlur: () => ctx.tryFlush() }),
      h('div', { class: 'task-properties' },
        h('div', { class: 'property' }, h('span', { class: 'field-label' }, 'Status'), segmented('Task status', [['open', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']], task.status, status => ctx.attempt(() => ctx.changeStatus(task.id, status)))),
        field('Due date', input('dueAt', task.dueAt, { type: 'date', onChange: event => { ctx.changeTask({ dueAt: event.target.value || null }); ctx.tryFlush(); } })),
      ),
      TagPicker(state, ctx, task),
      h('section', { class: 'subtasks-section' }, h('div', { class: 'section-heading' }, h('h3', {}, 'Subtasks'), children.length > 0 && h('span', { class: 'count' }, `${children.filter(child => child.status === 'done').length}/${children.length}`)),
        h('div', { class: 'subtasks-list' }, children.map(child => h('div', { class: 'subtask-row', key: child.id, 'data-task-id': child.id }, h('input', { type: 'checkbox', class: 'task-checkbox', checked: child.status === 'done', 'aria-label': `Complete ${child.title}`, onChange: event => ctx.toggleTask(child.id, event.currentTarget) }), button(child.title, () => ctx.edit(child.id), { class: `task-title ${child.status === 'done' ? 'is-done' : ''}` }), iconButton('trash', `Delete ${child.title}`, () => ctx.deleteTask(child.id), { class: 'icon-button subtask-delete' })))),
        h('form', { class: 'subtask-form', onSubmit: async event => {
          event.preventDefault(); const form = event.currentTarget;
          if (form.dataset.busy || !form.elements.title.value.trim()) return; form.dataset.busy = 'true';
          try { await ctx.createSubtask(task.id, form.elements.title.value); form.reset(); form.elements.title.focus(); }
          catch (error) { ctx.showError(error); }
          finally { delete form.dataset.busy; }
        } }, input('subtask-title', '', { name: 'title', placeholder: 'Add a subtask…', 'aria-label': 'New subtask', required: true, maxlength: 1000 }), iconButton('plus', 'Add subtask', null, { type: 'submit', disabled: state.saving }))),
      h('section', { class: 'notes-section', 'aria-label': 'Notes' }, h('div', { class: 'document-host', key: `${task.id}:document`, onMount: node => ctx.mountNotes(node, task.id), onUnmount: node => ctx.unmountNotes(node) })),
      files.length > 0 && h('section', { class: 'file-list' }, h('h3', {}, 'Files'), files.map(file => button(file.name, () => ctx.downloadFile(file), { class: 'text-button', key: file.id }))),
    ),
    h('div', { class: 'panel-save-status', 'aria-live': 'polite', title: 'Changes save automatically. Ctrl/Cmd+S saves immediately.' }, h('span', { class: state.ui.editError ? 'danger' : '' }, state.ui.editStatus), state.ui.editError && h('div', { class: 'save-error' }, h('p', {}, state.ui.editError), h('div', { class: 'actions' }, button('Retry', () => ctx.tryFlush(), { class: 'text-button' }), button('Discard', () => ctx.discardEditor(), { class: 'text-button danger', title: 'Discard unsaved changes and close this task.' })))),
  );
}
