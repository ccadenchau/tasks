export function observeLayout(node, measure, attributes = []) {
  let frame;
  const options = { childList: true, characterData: true, subtree: true, ...(attributes.length ? { attributes: true, attributeFilter: attributes } : {}) };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!node.isConnected) return;
      mutations.disconnect();
      try { measure(); } finally { mutations.observe(node, options); }
    });
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

export function mountTagOverflow(node) {
  queueMicrotask(() => {
    if (!node.isConnected) return;
    node.disposeLayout = observeLayout(node, () => {
      const chips = [...node.querySelectorAll(':scope > .tag')], more = node.querySelector('.tag-overflow');
      if (!more) return;
      chips.forEach(chip => { chip.hidden = false; }); more.hidden = false;
      const widths = chips.map(chip => chip.getBoundingClientRect().width), gap = 6;
      let count = chips.length, total = widths.reduce((sum, width) => sum + width, 0);
      if (total + Math.max(0, count - 1) * gap > node.clientWidth) {
        while (count > 0) {
          total -= widths[--count];
          const label = `+${chips.length - count}`;
          if (more.textContent !== label) more.textContent = label;
          if (total + count * gap + more.getBoundingClientRect().width <= node.clientWidth) break;
        }
      }
      chips.forEach((chip, index) => { chip.hidden = index >= count; });
      more.hidden = count === chips.length;
      more.title = chips.slice(count).map(chip => chip.textContent).join(', ');
      more.setAttribute('aria-label', `${chips.length - count} more tags: ${more.title}`);
    });
  });
}
