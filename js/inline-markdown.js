import { Schema, Slice, EditorState, TextSelection, EditorView, schema as commonSchema, MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer, baseKeymap, chainCommands, createParagraphNear, exitCode, liftEmptyBlock, newlineInCode, splitBlock, toggleMark, history, undo, redo, keymap, InputRule, inputRules, wrappingInputRule, textblockTypeInputRule, undoInputRule, splitListItem, sinkListItem, liftListItem } from './vendor/prosemirror.js';
import { safeUrl } from './document.js';

const alignment = value => ['left', 'center', 'right'].includes(value) ? value : null;
const cellSpec = tag => ({ content: 'paragraph+', attrs: { align: { default: null } }, parseDOM: [{ tag, getAttrs: node => ({ align: alignment(node.getAttribute('align')) }) }], toDOM: node => [tag, { align: node.attrs.align }, 0] });
const listItem = { ...commonSchema.spec.nodes.get('list_item'), attrs: { checked: { default: null } }, parseDOM: [{ tag: 'li', getAttrs: node => ({ checked: node.hasAttribute('data-checked') ? node.getAttribute('data-checked') === 'true' : null }) }], toDOM: node => node.attrs.checked === null ? ['li', 0] : ['li', { class: 'note-task-item', 'data-checked': String(node.attrs.checked) }, ['input', { type: 'checkbox', class: 'note-check', checked: node.attrs.checked ? '' : null, contenteditable: 'false', autocomplete: 'off', 'aria-label': 'Complete note checklist item' }], ['div', 0]] };
const link = { ...commonSchema.spec.marks.get('link'), parseDOM: [{ tag: 'a[href]', getAttrs: node => { const href = safeUrl(node.getAttribute('href')); return href ? { href, title: node.getAttribute('title') } : false; } }], toDOM: mark => ['a', { href: safeUrl(mark.attrs.href), title: mark.attrs.title, target: '_blank', rel: 'noopener noreferrer' }, 0] };

export const markdownSchema = new Schema({
  nodes: commonSchema.spec.nodes.remove('image').update('heading', { ...commonSchema.spec.nodes.get('heading'), content: 'text*' }).update('list_item', listItem).append({
    table: { content: 'table_row+', group: 'block', isolating: true, parseDOM: [{ tag: 'table' }], toDOM: () => ['table', ['tbody', 0]] },
    table_row: { content: '(table_cell | table_header)+', parseDOM: [{ tag: 'tr' }], toDOM: () => ['tr', 0] },
    table_cell: cellSpec('td'), table_header: cellSpec('th'),
  }),
  marks: commonSchema.spec.marks.update('link', link).append({ strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] } }),
});

const tokenizer = defaultMarkdownParser.tokenizer;
tokenizer.disable('image').enable(['table', 'strikethrough']);
tokenizer.validateLink = value => Boolean(safeUrl(value));
const { image, ...tokens } = defaultMarkdownParser.tokens;
export const markdownParser = new MarkdownParser(markdownSchema, tokenizer, { ...tokens, s: { mark: 'strike' }, table: { block: 'table' }, tr: { block: 'table_row' }, thead: { ignore: true }, tbody: { ignore: true } });

for (const [tag, type] of [['td', 'table_cell'], ['th', 'table_header']]) {
  markdownParser.tokenHandlers[`${tag}_open`] = (state, token) => { state.openNode(markdownSchema.nodes[type], { align: alignment(token.attrGet('style')?.match(/text-align:\s*(left|center|right)/)?.[1]) }); state.openNode(markdownSchema.nodes.paragraph, null); };
  markdownParser.tokenHandlers[`${tag}_close`] = state => { state.closeNode(); state.closeNode(); };
}
markdownParser.tokenHandlers.list_item_open = (state, token, all, index) => {
  const inline = all[index + 2], match = inline?.type === 'inline' && /^\[([ xX])\]\s/.exec(inline.content);
  if (match && inline.children?.[0]?.type === 'text') { inline.content = inline.content.slice(match[0].length); inline.children[0].content = inline.children[0].content.slice(match[0].length); }
  state.openNode(markdownSchema.nodes.list_item, { checked: match ? match[1].toLowerCase() === 'x' : null });
};

export const markdownSerializer = new MarkdownSerializer({ ...defaultMarkdownSerializer.nodes,
  list_item(state, node) { if (node.attrs.checked !== null) state.write(`[${node.attrs.checked ? 'x' : ' '}] `); state.renderContent(node); },
  table(state, node) {
    node.forEach((row, _, index) => {
      const cells = [];
      row.forEach(cell => cells.push(markdownSerializer.serialize(markdownSchema.node('doc', null, cell.content)).trim().replace(/\n+/g, ' ').replace(/\|/g, '\\|')));
      state.write(`| ${cells.join(' | ')} |`); state.ensureNewLine();
      if (!index) { const dividers = []; row.forEach(cell => dividers.push(cell.attrs.align === 'center' ? ':---:' : cell.attrs.align === 'right' ? '---:' : cell.attrs.align === 'left' ? ':---' : '---')); state.write(`| ${dividers.join(' | ')} |`); state.ensureNewLine(); }
    });
    state.closeBlock(node);
  },
}, { ...defaultMarkdownSerializer.marks, strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true } });

function markRule(expression, type, group = 1) {
  return new InputRule(expression, (state, match, start, end) => {
    const prefix = group === 2 ? (match[1] || '').length : 0, text = match[group];
    const from = start + prefix, transaction = state.tr.replaceWith(from, end, markdownSchema.text(text, [type.create()]));
    return transaction.setSelection(TextSelection.create(transaction.doc, from + text.length)).removeStoredMark(type);
  }, { inCodeMark: false });
}

export function markdownInputRules() {
  const { nodes, marks } = markdownSchema;
  return [
    textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, match => ({ level: match[1].length })),
    wrappingInputRule(/^>\s$/, nodes.blockquote),
    wrappingInputRule(/^\s*[-+*]\s$/, nodes.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, match => ({ order: Number(match[1]) })),
    textblockTypeInputRule(/^```$/, nodes.code_block),
    new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
      const { $from } = state.selection, depth = $from.depth - 1;
      if (depth < 1 || $from.node(depth).type !== nodes.list_item) return null;
      return state.tr.delete(start, end).setNodeMarkup($from.before(depth), null, { checked: match[1].toLowerCase() === 'x' });
    }),
    markRule(/\*\*([^*]+)\*\*$/, marks.strong), markRule(/__([^_]+)__$/, marks.strong),
    markRule(/(?:^|([^*]))\*([^*]+)\*$/, marks.em, 2), markRule(/(?:^|([^_]))_([^_]+)_$/, marks.em, 2),
    markRule(/`([^`]+)`$/, marks.code), markRule(/~~([^~]+)~~$/, marks.strike),
    new InputRule(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)$/, (state, match, start, end) => state.tr.replaceWith(start, end, markdownSchema.text(match[1], [marks.link.create({ href: safeUrl(match[2]) })])).removeStoredMark(marks.link), { inCodeMark: false }),
  ];
}

function editorPlugins() {
  return [inputRules({ rules: markdownInputRules() }), keymap({
    'Mod-b': toggleMark(markdownSchema.marks.strong), 'Mod-i': toggleMark(markdownSchema.marks.em), 'Mod-`': toggleMark(markdownSchema.marks.code),
    'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, Backspace: undoInputRule,
    Enter: chainCommands(newlineInCode, (state, dispatch, view) => splitListItem(markdownSchema.nodes.list_item, { checked: state.selection.$from.node(-1).attrs.checked === null ? null : false })(state, dispatch, view), createParagraphNear, liftEmptyBlock, splitBlock),
    'Shift-Enter': chainCommands(exitCode, (state, dispatch) => { if (dispatch) dispatch(state.tr.replaceSelectionWith(markdownSchema.nodes.hard_break.create()).scrollIntoView()); return true; }),
    Tab: sinkListItem(markdownSchema.nodes.list_item), 'Shift-Tab': liftListItem(markdownSchema.nodes.list_item),
  }), keymap(baseKeymap), history()];
}

export function mountInlineMarkdownEditor(host, { value = '', onChange, onError }) {
  const state = markdown => EditorState.create({ doc: markdownParser.parse(markdown), plugins: editorPlugins() });
  const updateEmpty = () => { view.dom.dataset.empty = String(!view.state.doc.textContent && view.state.doc.childCount === 1); };
  const view = new EditorView(host, {
    state: state(value), attributes: { class: 'markdown-editor', role: 'textbox', 'aria-label': 'Task notes (Markdown)', 'aria-multiline': 'true', 'data-placeholder': 'Write notes…', autocomplete: 'off' },
    dispatchTransaction(transaction) {
      try {
        if (transaction.doc.textContent.length > 1000000) throw new Error('Notes are limited to 1,000,000 characters.');
        view.updateState(view.state.apply(transaction)); updateEmpty();
        if (transaction.docChanged) onChange(markdownSerializer.serialize(view.state.doc));
      } catch (error) { onError(error); }
    },
    handleDOMEvents: {
      paste(editor, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined) return false;
        event.preventDefault();
        try { const doc = markdownParser.parse(text); editor.dispatch(editor.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView()); } catch (error) { onError(error); }
        return true;
      },
      change(editor, event) {
        if (!event.target.matches?.('input.note-check')) return false;
        const position = editor.state.doc.resolve(editor.posAtDOM(event.target, 0));
        for (let depth = position.depth; depth > 0; depth--) if (position.node(depth).type === markdownSchema.nodes.list_item) {
          editor.dispatch(editor.state.tr.setNodeMarkup(position.before(depth), null, { checked: event.target.checked })); return true;
        }
        return false;
      },
    },
  });
  updateEmpty();
  return { getMarkdown: () => markdownSerializer.serialize(view.state.doc), setValue(markdown) { view.updateState(state(markdown)); updateEmpty(); }, destroy: () => view.destroy() };
}
