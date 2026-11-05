import { h } from './dom.js';

export const button = (label, onClick, props = {}) => h('button', { type: 'button', class: 'button', onClick, ...props }, label);
export const input = (name, value, props = {}) => h('input', { class: 'input', name, id: name, value: value ?? '', ...props });
export const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);

export function iconButton(name, label, onClick, props = {}) {
  const paths = { trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'], close: ['m6 6 12 12M6 18 18 6'], plus: ['M12 5v14M5 12h14'] };
  return button(h('svg', { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, (paths[name] || paths.close).map(d => h('path', { d }))), onClick, { class: 'icon-button', title: label, 'aria-label': label, ...props });
}

export function segmented(label, options, selected, onSelect) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label, css: { '--segment-count': options.length, '--selected-index': Math.max(0, options.findIndex(([value]) => value === selected)) } }, options.map(([value, text]) => button(text, () => onSelect(value), { class: `segment ${selected === value ? 'selected' : ''}`, 'aria-pressed': String(selected === value), key: value })));
}

export function formatDate(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
