const SVG_NS = 'http://www.w3.org/2000/svg';
const TEXT = Symbol('text');

export function h(tag, props, ...children) {
  if (['input', 'textarea', 'form'].includes(tag)) props = { autocomplete: 'off', ...props };
  return { tag, props: props || {}, key: props?.key, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false).map(child => typeof child === 'object' ? child : { tag: TEXT, text: String(child), props: {}, children: [] }) };
}

function setProps(node, previous, next) {
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (['key', 'onMount', 'onUnmount', 'preserveWhileFocused'].includes(key) || previous[key] === next[key]) continue;
    const value = next[key];
    if (key === 'css') {
      for (const property of new Set([...Object.keys(previous.css || {}), ...Object.keys(value || {})])) {
        if (!property.startsWith('--')) continue;
        if (value?.[property] === undefined) node.style.removeProperty(property);
        else node.style.setProperty(property, value[property]);
      }
    } else if (/^on[A-Z]/.test(key)) {
      const event = key.slice(2).toLowerCase();
      if (previous[key]) node.removeEventListener(event, previous[key]);
      if (value) node.addEventListener(event, value);
    } else if (key === 'class') {
      node.setAttribute('class', value || '');
    } else if (key === 'value' && 'value' in node) {
      if (!(next.preserveWhileFocused && document.activeElement === node) && node.value !== String(value ?? '')) node.value = value ?? '';
    } else if (['checked', 'disabled', 'hidden', 'open', 'draggable'].includes(key)) {
      node[key] = Boolean(value);
      if (!value) node.removeAttribute(key);
    } else if (value === null || value === undefined || value === false) node.removeAttribute(key);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
}

function create(vnode, svg = false) {
  if (vnode.tag === TEXT) { vnode.node = document.createTextNode(vnode.text); return vnode.node; }
  const isSvg = svg || vnode.tag === 'svg';
  vnode.node = isSvg ? document.createElementNS(SVG_NS, vnode.tag) : document.createElement(vnode.tag);
  setProps(vnode.node, {}, vnode.props);
  for (const child of vnode.children) vnode.node.append(create(child, isSvg));
  vnode.props.onMount?.(vnode.node);
  return vnode.node;
}

function destroy(vnode) {
  vnode.props.onUnmount?.(vnode.node);
  vnode.children.forEach(destroy);
}

function patch(parent, previous, next, svg = false) {
  if (!previous) { parent.append(create(next, svg)); return next; }
  if (previous.tag !== next.tag || previous.key !== next.key) {
    parent.replaceChild(create(next, svg), previous.node); destroy(previous); return next;
  }
  const node = next.node = previous.node;
  if (next.tag === TEXT) { if (previous.text !== next.text) node.data = next.text; return next; }
  setProps(node, previous.props, next.props);
  const keyed = new Map(previous.children.filter(child => child.key != null).map(child => [child.key, child]));
  const used = new Set();
  next.children.forEach((child, index) => {
    const candidate = child.key != null ? keyed.get(child.key) : previous.children[index]?.key == null ? previous.children[index] : null;
    const old = candidate && !used.has(candidate) ? candidate : null;
    if (old) used.add(old);
    patch(node, old, child, svg || next.tag === 'svg');
    if (node.childNodes[index] !== child.node) node.insertBefore(child.node, node.childNodes[index] || null);
  });
  for (const child of previous.children) if (!used.has(child)) { destroy(child); child.node.remove(); }
  return next;
}

export function mount(container, render) {
  let tree = null, scheduled = false;
  function flush() { scheduled = false; tree = patch(container, tree, render()); }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } }
  flush();
  return { schedule, flush };
}
