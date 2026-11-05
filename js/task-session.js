import { documentFromText, documentText, validateDocument } from './document.js';
import { now } from './model.js';

export function createTaskSession(task, store, { onStatus = () => {}, delay = 600 } = {}) {
  let queue = Promise.resolve();
  const session = { id: task.id, base: structuredClone(task), draft: structuredClone(task), dirty: false, version: 0, saving: false, api: null, timer: null };

  function schedule() {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => flush().catch(() => {}), delay);
  }
  function change(fields) {
    Object.assign(session.draft, fields); session.dirty = true; session.version++;
    onStatus('Unsaved'); schedule();
  }
  async function save() {
    if (session.api) { session.draft.markdown = session.api.getMarkdown(); session.draft.document = documentFromText(session.draft.markdown); }
    session.draft.description = documentText(session.draft.document);
    validateDocument(session.draft.document);
    const draft = structuredClone(session.draft), base = structuredClone(session.base), version = session.version;
    session.saving = true; onStatus('Saving…');
    try {
      await store.mutate(data => {
        const current = data.tasks.find(task => task.id === session.id);
        if (!current) throw new Error('This task was deleted. Copy your notes before discarding this draft.');
        if (JSON.stringify(current) !== JSON.stringify(base)) throw new Error('This task changed in another tab. Copy your notes before reopening it.');
        Object.assign(current, draft, { title: draft.title.trim(), updatedAt: now() });
      });
      session.base = structuredClone(store.getState().data.tasks.find(task => task.id === session.id));
      session.draft.updatedAt = session.base.updatedAt;
      session.dirty = session.version !== version;
      onStatus(session.dirty ? 'Unsaved' : 'Saved');
    } finally { session.saving = false; }
  }
  function flush() {
    clearTimeout(session.timer);
    const operation = queue.then(async () => { while (session.dirty) await save(); });
    queue = operation.catch(error => { session.dirty = true; onStatus('Save failed', error.message); });
    return operation;
  }
  function invalid(error) { session.dirty = true; session.version++; onStatus('Save failed', error.message); }
  return Object.assign(session, { change, flush, invalid, dispose: () => clearTimeout(session.timer) });
}
