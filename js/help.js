import { h } from './dom.js';
import { iconButton } from './controls.js';
import { SHORTCUT_GROUPS } from './shortcuts.js';

export function ShortcutHelp(ctx) {
  return h('dialog', { class: 'modal shortcut-help', key: 'shortcut-help', 'aria-labelledby': 'shortcut-help-title', onMount: node => queueMicrotask(() => { node.showModal(); node.querySelector('button')?.focus(); }), onCancel: event => { event.preventDefault(); ctx.closeHelp(); }, onClick: event => { if (event.target === event.currentTarget) ctx.closeHelp(); } },
    h('div', { class: 'modal-header' }, h('h2', { id: 'shortcut-help-title' }, 'Keyboard shortcuts'), iconButton('close', 'Close help', ctx.closeHelp)),
    h('div', { class: 'modal-body' }, SHORTCUT_GROUPS.map(([title, shortcuts]) => h('section', { class: 'shortcut-group', key: title }, h('h3', {}, title), h('dl', { class: 'shortcut-list' }, shortcuts.map(([keys, action]) => h('div', { class: 'shortcut-row', key: action }, h('dt', {}, action), h('dd', {}, keys.map(key => h('kbd', {}, key))))))))),
  );
}
