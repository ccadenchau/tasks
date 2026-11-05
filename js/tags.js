import { h } from './dom.js';
import { normalizeColor, tagAppearance, TAG_PALETTE } from './tag-colors.js';
import { button, field, iconButton, input } from './controls.js';

export function tagChip(tag, onClick, { selected = false, onRemove } = {}) {
  const children = [h('span', { class: 'tag-dot', 'aria-hidden': 'true' }), h('span', { class: 'tag-text' }, tag.name), selected && h('span', { class: 'tag-selected', 'aria-hidden': 'true' }, '✓')];
  const props = { class: `tag ${selected ? 'tag--selected' : ''}`, css: tagAppearance(tag.color || 'blue'), key: tag.id, title: tag.name };
  if (onRemove) return h('span', { ...props, class: 'tag assigned-tag' }, button(children, onClick, { class: 'tag-label', title: `View ${tag.name} tasks` }), iconButton('close', `Remove ${tag.name}`, onRemove, { class: 'icon-button tag-remove-button' }));
  return onClick ? button(children, onClick, { ...props, 'aria-pressed': String(selected) }) : h('span', props, children);
}

export function TagViews(state, ctx) {
  return h('nav', { class: 'task-views', 'aria-label': 'Task views', 'data-keep-panel': '' },
    button('All tasks', () => ctx.viewTag(null), { class: `task-view ${!state.ui.tagIds.length ? 'selected' : ''}`, 'aria-pressed': String(!state.ui.tagIds.length) }),
    state.data.tags.map(tag => tagChip(tag, () => ctx.viewTag(tag.id), { selected: state.ui.tagIds.includes(tag.id) })),
  );
}

export function TagPicker(state, ctx, task) {
  const query = (state.ui.tagQuery || '').trim().toLocaleLowerCase();
  const searching = state.ui.tagSearchOpen && query.length > 0;
  const matches = searching ? state.data.tags.filter(tag => tag.name.toLocaleLowerCase().includes(query)) : [];
  const assigned = task.tagIds.map(id => state.data.tags.find(tag => tag.id === id)).filter(Boolean);
  return h('section', { class: 'task-tags-editor' },
    h('div', { class: 'section-heading' }, h('h3', {}, 'Tags')),
    h('div', { class: 'assigned-tags', key: 'assigned-tags' }, assigned.length ? assigned.map(tag => tagChip(tag, () => ctx.viewTag(tag.id), { onRemove: () => ctx.toggleTag(tag.id) })) : h('span', { class: 'tags-empty' }, 'No tags')),
    h('div', { class: 'tag-search', key: 'tag-search', onFocusout: event => { if (!event.currentTarget.contains(event.relatedTarget)) ctx.store.ui({ tagSearchOpen: false }); } },
      input('tag-search', state.ui.tagQuery || '', { type: 'search', placeholder: 'Find a tag to add…', 'aria-label': 'Find a tag to add or remove', preserveWhileFocused: true, 'aria-expanded': String(Boolean(searching)), 'aria-controls': 'tag-search-results', onFocus: () => ctx.store.ui({ tagSearchOpen: true }), onInput: event => ctx.store.ui({ tagQuery: event.target.value, tagSearchOpen: true }), onKeydown: event => { if (event.key === 'Escape' && state.ui.tagSearchOpen) { event.preventDefault(); event.stopPropagation(); ctx.store.ui({ tagSearchOpen: false }); } } }),
      searching && h('div', { class: 'tag-search-results', id: 'tag-search-results', 'aria-label': 'Matching tags' }, matches.length ? matches.map(tag => tagChip(tag, () => ctx.toggleTag(tag.id), { selected: task.tagIds.includes(tag.id) })) : h('div', { class: 'tag-search-empty' }, button('Create tag', () => ctx.openTags(task.id), { class: 'text-button' }))),
    ),
  );
}

function setFormColor(form, value, keepText = false) {
  const color = normalizeColor(value);
  form.elements.color.value = color;
  if (!keepText) form.elements.hex.value = color;
  form.querySelectorAll('[data-color]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.color === color)));
}

export function TagManager(state, ctx) {
  const tag = state.data.tags.find(tag => tag.id === state.ui.tagEdit), color = normalizeColor(tag?.color || 'blue');
  return h('dialog', { class: 'modal tag-modal', key: 'tag-modal', 'aria-labelledby': 'tag-modal-title', onMount: node => queueMicrotask(() => { node.showModal(); node.querySelector('#tag-name')?.focus(); }), onCancel: event => { event.preventDefault(); ctx.closeTags(); }, onClick: event => { if (event.target === event.currentTarget) ctx.closeTags(); } },
    h('div', { class: 'modal-header' }, h('h2', { id: 'tag-modal-title' }, tag ? 'Edit tag' : 'Create tag'), iconButton('close', 'Close tag editor', ctx.closeTags)),
    h('div', { class: 'modal-body' },
      h('div', { class: 'tag-manager-list' }, tag && button('Create tag', () => ctx.selectTag(null), { class: 'button button--small' }), state.data.tags.map(item => tagChip(item, () => ctx.selectTag(item.id), { selected: tag?.id === item.id }))),
      h('form', { class: 'tag-form', key: state.ui.tagFormKey, onSubmit: async event => {
        event.preventDefault(); const form = event.currentTarget;
        if (form.dataset.busy) return; form.dataset.busy = 'true';
        try { await ctx.saveTag({ id: tag?.id, name: form.elements.name.value, color: normalizeColor(form.elements.hex.value) }); }
        catch (error) { const message = form.querySelector('[data-tag-error]'); message.textContent = error.message; message.hidden = false; }
        finally { delete form.dataset.busy; }
      } },
        field('Name', input('tag-name', tag?.name || '', { name: 'name', required: true, maxlength: 100, placeholder: 'Tag name' })),
        h('fieldset', { class: 'color-picker' }, h('legend', {}, 'Color'), h('div', { class: 'preset-colors' }, Object.entries(TAG_PALETTE).map(([name, value]) => button(h('span', { class: 'swatch-fill' }), event => setFormColor(event.currentTarget.form, value), { class: 'color-swatch', css: tagAppearance(value), title: name, 'aria-label': name, 'aria-pressed': String(color === value), 'data-color': value, key: name })))),
        h('div', { class: 'custom-color' }, input('tag-color', color, { type: 'color', name: 'color', 'aria-label': 'Choose any tag color', onInput: event => setFormColor(event.target.form, event.target.value) }), input('tag-hex', color, { name: 'hex', 'aria-label': 'Hex color', pattern: '#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})', required: true, title: 'Use #RGB or #RRGGBB.', maxlength: 7, onInput: event => { try { setFormColor(event.target.form, event.target.value, true); } catch { /* Leave partial hex input editable. */ } }, onBlur: event => { try { setFormColor(event.target.form, event.target.value); } catch {} } })),
        h('p', { class: 'error', role: 'alert', hidden: true, 'data-tag-error': '' }),
        h('div', { class: 'tag-form-actions' }, tag && iconButton('trash', 'Delete tag', () => ctx.deleteTag(tag.id), { class: 'icon-button danger', disabled: state.saving }), h('span', { class: 'grow' }), h('button', { type: 'submit', class: 'button button--primary', disabled: state.saving }, tag ? 'Save tag' : 'Create tag')),
      ),
    ),
  );
}
