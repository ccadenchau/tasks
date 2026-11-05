import { h } from './dom.js';
import { button, iconButton } from './controls.js';

export function Confirmation(state, ctx) {
  const confirmation = state.ui.confirmation;
  if (!confirmation) return null;
  return h('dialog', { class: 'modal confirm-modal', key: confirmation.key, 'aria-labelledby': 'confirmation-title', onMount: node => queueMicrotask(() => { node.showModal(); node.querySelector('[data-cancel]')?.focus(); }), onCancel: event => { event.preventDefault(); ctx.closeConfirmation(); } },
    h('div', { class: 'modal-header' }, h('h2', { id: 'confirmation-title' }, confirmation.title), iconButton('close', 'Cancel', ctx.closeConfirmation)),
    h('div', { class: 'modal-body confirm-body' }, h('p', {}, confirmation.message), h('p', { class: 'error', hidden: true, role: 'alert', 'data-confirm-error': '' })),
    h('form', { class: 'confirm-actions', onSubmit: async event => {
      event.preventDefault(); const form = event.currentTarget;
      if (form.dataset.busy) return; form.dataset.busy = 'true';
      try { await confirmation.action(); ctx.closeConfirmation(); }
      catch (error) { const target = form.closest('dialog').querySelector('[data-confirm-error]'); target.textContent = error.message; target.hidden = false; }
      finally { delete form.dataset.busy; }
    } }, button('Cancel', ctx.closeConfirmation, { 'data-cancel': '' }), h('button', { class: 'button button--danger', type: 'submit', disabled: state.saving }, confirmation.label || 'Delete')),
  );
}
