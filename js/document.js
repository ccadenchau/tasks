const TYPES = ['paragraph', 'heading', 'bullet', 'number', 'quote', 'code', 'check'];
const MARKS = ['bold', 'italic', 'underline', 'code'];

export function documentFromText(text = '') {
  return { version: 1, blocks: String(text).split('\n').map(text => ({ type: 'paragraph', children: [{ text }] })) };
}

export const documentText = value => value.blocks.map(block => block.children.map(span => span.text).join('')).join('\n');

export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function validateDocument(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length > 5000) throw new Error('Invalid document.');
  let length = 0;
  for (const block of value.blocks) {
    if (!TYPES.includes(block.type) || !Array.isArray(block.children) || block.children.length > 5000 || (block.type === 'heading' && ![1, 2, 3].includes(block.level))) throw new Error('Invalid document block.');
    for (const span of block.children) {
      if (typeof span.text !== 'string' || (span.marks && (!Array.isArray(span.marks) || span.marks.some(mark => !MARKS.includes(mark)))) || (span.href && (typeof span.href !== 'string' || !safeUrl(span.href)))) throw new Error('Invalid document text or link.');
      length += span.text.length;
      if (length > 1000000) throw new Error('Notes are limited to 1,000,000 characters.');
    }
  }
  return value;
}

export function documentToMarkdown(value) {
  const escape = text => text.replace(/([\\`*_[\]<>])/g, '\\$1');
  return value.blocks.map(block => {
    if (block.type === 'code') return `\`\`\`\n${block.children.map(span => span.text).join('')}\n\`\`\``;
    const content = block.children.map(span => {
      let text = escape(span.text);
      if (span.marks?.includes('code')) text = `\`${span.text.replace(/`/g, '\\`')}\``;
      if (span.marks?.includes('bold')) text = `**${text}**`;
      if (span.marks?.includes('italic')) text = `*${text}*`;
      if (span.href && safeUrl(span.href)) text = `[${text}](${encodeURI(span.href).replace(/[()]/g, character => character === '(' ? '%28' : '%29')})`;
      return text;
    }).join('');
    return block.type === 'heading' ? `${'#'.repeat(block.level)} ${content}` : block.type === 'bullet' ? `- ${content}` : block.type === 'number' ? `1. ${content}` : block.type === 'quote' ? content.split('\n').map(line => `> ${line}`).join('\n') : block.type === 'check' ? `- [${block.checked ? 'x' : ' '}] ${content}` : content;
  }).join('\n\n');
}
