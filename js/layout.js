function observeLayout(node, measure, attributes = []) {
  let frame;
  const options = { childList: true, characterData: true, subtree: true, ...(attributes.length ? { attributes: true, attributeFilter: attributes } : {}) };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { if (node.isConnected) measure(); });
  };
  const mutations = new MutationObserver(schedule);
  mutations.observe(node, options);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resize?.observe(node);
  window.addEventListener('resize', schedule);
  schedule();
  return () => { cancelAnimationFrame(frame); mutations.disconnect(); resize?.disconnect(); window.removeEventListener('resize', schedule); };
}

export function mountTabTrack(node) {
  queueMicrotask(() => {
    if (!node.isConnected) return;
    node.disposeLayout = observeLayout(node, () => {
      const selected = node.querySelector('[aria-pressed="true"]');
      if (!selected) return;
      node.style.setProperty('--track-left', `${selected.offsetLeft}px`);
      node.style.setProperty('--track-width', `${selected.offsetWidth}px`);
    }, ['aria-pressed']);
  });
}
