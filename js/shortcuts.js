export const SHORTCUT_GROUPS = [
  ['General', [
    [['Cmd/Ctrl + Shift + A'], 'Add task'],
    [['Cmd/Ctrl + K'], 'Search'],
    [['Escape'], 'Close sidebar or dialog'],
  ]],
  ['Outside text fields', [
    [['N'], 'Add task'],
    [['/'], 'Search'],
    [['V'], 'Switch list / board'],
    [['T'], 'Edit tags'],
    [['M'], 'Restore drag order'],
    [['Delete'], 'Delete open task'],
    [['?'], 'Keyboard shortcuts'],
  ]],
  ['Task editor', [
    [['Cmd/Ctrl + S'], 'Save task'],
    [['Cmd/Ctrl + Enter'], 'Complete / reopen task'],
  ]],
  ['Notes', [
    [['Cmd/Ctrl + B'], 'Bold'],
    [['Cmd/Ctrl + I'], 'Italic'],
    [['Cmd/Ctrl + `'], 'Inline code'],
    [['Cmd/Ctrl + Z'], 'Undo'],
    [['Cmd/Ctrl + Shift + Z', 'Cmd/Ctrl + Y'], 'Redo'],
    [['Tab'], 'Indent list item'],
    [['Shift + Tab'], 'Outdent list item'],
    [['Shift + Enter'], 'Line break / exit code block'],
    [['Backspace'], 'Undo Markdown autoformat'],
  ]],
  ['Sidebar divider focused', [
    [['←', '→'], 'Widen / narrow sidebar'],
    [['Home'], 'Minimum width'],
    [['End'], 'Maximum width'],
  ]],
];

export function handleShortcut(event, ctx) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  const ui = ctx.store.getState().ui;
  if (ui.tagsOpen || ui.confirmation) return false;
  const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
  if (ui.helpOpen) {
    if (key !== 'escape') return false;
    event.preventDefault(); ctx.closeHelp(); return true;
  }
  const typing = Boolean(event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  let action;
  if (command && key === 'k') action = ctx.focusSearch;
  else if (command && event.shiftKey && key === 'a') action = ctx.createTask;
  else if (command && key === 's' && ui.editing) action = ctx.tryFlush;
  else if (command && key === 'enter' && ui.editing) action = ctx.toggleCurrentTask;
  else if (key === 'escape' && ui.editing) action = ctx.closeEditor;
  else if (!typing && !command && !event.altKey) {
    action = ({ '/': ctx.focusSearch, n: ctx.createTask, v: ctx.toggleView, t: ctx.openTags, m: ctx.resetOrder, '?': ctx.openHelp })[key];
    if (key === 'delete' && ui.editing) action = () => ctx.deleteTask(ui.editing.id);
  }
  if (!action) return false;
  event.preventDefault(); action(); return true;
}
