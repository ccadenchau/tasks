let toastTimer;

export function celebrateCompletion(id, anchor) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelector('.completion-toast')?.remove(); clearTimeout(toastTimer);
  const toast = document.createElement('div'); toast.className = 'completion-toast'; toast.setAttribute('role', 'status');
  const check = document.createElement('span'); check.className = 'completion-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
  toast.append(check, document.createTextNode('Completed')); document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 1400);
  if (reducedMotion) return;
  requestAnimationFrame(() => {
    const item = [...document.querySelectorAll('[data-task-id]')].find(node => node.dataset.taskId === id);
    item?.animate([{ backgroundColor: '#dcfce7', transform: 'scale(.98)' }, { backgroundColor: 'transparent', transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const rect = anchor || item?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : innerWidth / 2, y = rect ? rect.top + rect.height / 2 : innerHeight - 70;
    const burst = document.createElement('div'); burst.className = 'completion-burst'; burst.setAttribute('aria-hidden', 'true'); document.body.append(burst);
    for (let index = 0; index < 10; index++) {
      const particle = document.createElement('span'); particle.className = `completion-particle particle-${index % 5}`; burst.append(particle);
      const angle = Math.PI * 2 * index / 10, distance = 28 + index % 3 * 13;
      particle.animate([{ transform: `translate(${x}px, ${y}px) scale(.4)`, opacity: 1 }, { transform: `translate(${x + Math.cos(angle) * distance}px, ${y + Math.sin(angle) * distance + 12}px) rotate(${index * 65}deg) scale(.7)`, opacity: 0 }], { duration: 520 + index % 3 * 50, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
    }
    setTimeout(() => burst.remove(), 750);
  });
}
