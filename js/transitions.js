export function createContentTransition(getContent, flush) {
  let cleanup = () => {};
  return update => {
    cleanup();
    const outgoing = getContent();
    if (!outgoing?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); flush(); return; }
    const rect = outgoing.getBoundingClientRect(), snapshot = outgoing.cloneNode(true);
    snapshot.removeAttribute('id');
    snapshot.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    snapshot.classList.add('content-snapshot');
    snapshot.setAttribute('aria-hidden', 'true'); snapshot.inert = true;
    Object.assign(snapshot.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.append(snapshot);
    snapshot.scrollTop = outgoing.scrollTop;
    update(); flush();
    const incoming = getContent(), options = { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' };
    const exit = snapshot.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-5px)' }], options);
    const enter = incoming.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], options);
    cleanup = () => { exit.cancel?.(); enter.cancel?.(); snapshot.remove(); };
    Promise.allSettled([exit.finished, enter.finished]).then(() => snapshot.remove());
  };
}
