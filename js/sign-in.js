import { h, mount } from './dom.js';
import { field, input } from './controls.js';
import { createSyncApi } from './sync-api.js';

export function passwordAuthorization(password) {
  const bytes = new TextEncoder().encode(`admin:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

export function signIn(root, fetcher = globalThis.fetch.bind(globalThis)) {
  return new Promise(resolve => {
    let busy = false, error = '';
    root.replaceChildren();
    const screen = mount(root, () => h('main', { class: 'sign-in' },
      h('form', { class: 'sign-in-form', 'aria-labelledby': 'sign-in-title', 'aria-busy': String(busy), onSubmit: async event => {
        event.preventDefault();
        if (busy) return;
        const password = event.currentTarget.elements.password;
        if (!password.value) return;
        const api = createSyncApi(passwordAuthorization(password.value), fetcher);
        password.value = ''; busy = true; error = ''; screen.flush();
        try { await api.keys(); resolve(api); }
        catch (failure) {
          api.signOut();
          error = failure.status === 401 ? 'Incorrect password.' : 'Unable to connect. Check your connection and API access.';
          busy = false; screen.flush(); password.focus();
        }
      } },
        h('h1', { id: 'sign-in-title' }, 'Sign in'),
        field('Password', input('password', '', { type: 'password', name: 'password', required: true, maxlength: 512, disabled: busy, preserveWhileFocused: true, title: 'Your api.cadenchau.com password', onMount: node => queueMicrotask(() => node.focus()) })),
        error && h('p', { class: 'error', role: 'alert' }, error),
        h('button', { type: 'submit', class: 'button button--primary', disabled: busy }, busy ? 'Signing in…' : 'Continue'),
      ),
    ));
  });
}
