import { now, setTaskStatus, uid } from './model.js';

export function displayData(state) {
  const pending = state.ui.pendingStatuses || {};
  if (!Object.keys(pending).length) return state.data;
  return { ...state.data, tasks: state.data.tasks.map(task => pending[task.id] ? { ...task, status: pending[task.id].status, completedAt: pending[task.id].completedAt } : task) };
}

export function createStatusActions(store, { getSession = () => null, onComplete = () => {} } = {}) {
  async function change(id, status, anchor) {
    if (!['open', 'in_progress', 'done'].includes(status)) throw new Error('Invalid status.');
    const previous = displayData(store.getState()).tasks.find(task => task.id === id);
    if (!previous) throw new Error('Task not found.');
    const token = uid(), completedAt = status === 'done' ? now() : null;
    const session = getSession();
    store.ui({ pendingStatuses: { ...store.getState().ui.pendingStatuses, [id]: { token, status, completedAt } } });
    try {
      if (session?.id === id) { session.change({ status, completedAt }); await session.flush(); }
      else await store.mutate(data => setTaskStatus(data, id, status));
      const latest = store.getState().ui.pendingStatuses[id];
      if (latest?.token === token && status === 'done' && previous.status !== 'done' && store.getState().data.tasks.find(task => task.id === id)?.status === 'done') {
        try { onComplete(id, anchor); } catch { /* Feedback cannot turn a committed change into a failed save. */ }
      }
    } catch (error) {
      if (session?.id === id && store.getState().ui.pendingStatuses[id]?.token === token) {
        const saved = store.getState().data.tasks.find(task => task.id === id);
        if (saved) Object.assign(session.draft, { status: saved.status, completedAt: saved.completedAt });
      }
      throw error;
    } finally {
      const pending = { ...store.getState().ui.pendingStatuses };
      if (pending[id]?.token === token) { delete pending[id]; store.ui({ pendingStatuses: pending }); }
    }
  }
  return { change };
}
