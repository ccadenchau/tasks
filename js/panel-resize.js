export function clampPanelWidth(width, containerWidth) {
  const maximum = Math.max(260, containerWidth - 287);
  return Math.round(Math.max(260, Math.min(maximum, Number(width) || 460)));
}

export function attachPanelResize(divider, { onChange, onFinish }) {
  const panes = divider.parentElement;
  divider.setAttribute('aria-valuemax', clampPanelWidth(Infinity, panes.getBoundingClientRect().width));
  let dragging = false;
  const update = event => {
    const rect = panes.getBoundingClientRect();
    const width = clampPanelWidth(rect.right - event.clientX, rect.width);
    onChange(width);
  };
  const down = event => { if (event.button !== 0) return; event.preventDefault(); dragging = true; panes.classList.add('is-resizing'); divider.setPointerCapture(event.pointerId); update(event); };
  const move = event => { if (dragging) update(event); };
  const finish = () => { if (!dragging) return; dragging = false; panes.classList.remove('is-resizing'); onFinish(); };
  const keyboard = event => {
    const current = Number(divider.getAttribute('aria-valuenow')) || 460, width = panes.getBoundingClientRect().width;
    const next = event.key === 'ArrowLeft' ? current + 24 : event.key === 'ArrowRight' ? current - 24 : event.key === 'Home' ? 260 : event.key === 'End' ? width : null;
    if (next === null) return;
    event.preventDefault(); onChange(clampPanelWidth(next, width)); onFinish();
  };
  divider.addEventListener('pointerdown', down); divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', finish); divider.addEventListener('pointercancel', finish); divider.addEventListener('lostpointercapture', finish); divider.addEventListener('keydown', keyboard);
  return () => { divider.removeEventListener('pointerdown', down); divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', finish); divider.removeEventListener('pointercancel', finish); divider.removeEventListener('lostpointercapture', finish); divider.removeEventListener('keydown', keyboard); };
}
