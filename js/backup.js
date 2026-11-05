import { validateData } from './model.js';

const LIMIT = 100 * 1024 * 1024;

export function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function createBackup(data, repository) {
  const files = [];
  let size = new TextEncoder().encode(JSON.stringify(data)).length;
  for (const file of data.attachments) {
    const blob = await repository.getBlob(file.id);
    if (!blob || blob.size !== file.size) throw new Error(`Missing attachment: ${file.name}`);
    size += Math.ceil(blob.size / 3) * 4;
    if (size > LIMIT - 1024 * 1024) throw new Error('Backup exceeds 100 MB.');
    const bytes = new Uint8Array(await blob.arrayBuffer()), chunks = [];
    for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
    files.push({ id: file.id, base64: btoa(chunks.join('')) });
  }
  const backup = new Blob([JSON.stringify({ version: 2, data, files })], { type: 'application/json' });
  if (backup.size > LIMIT) throw new Error('Backup exceeds 100 MB.');
  return backup;
}

export async function readBackup(file) {
  if (file.size > LIMIT) throw new Error('Backup exceeds 100 MB.');
  const backup = JSON.parse(await file.text());
  if (backup.version !== 2 || !Array.isArray(backup.files)) throw new Error('Unsupported backup.');
  const data = validateData(backup.data), seen = new Set();
  if (backup.files.length !== data.attachments.length) throw new Error('Missing attachment data.');
  const metadata = new Map(data.attachments.map(file => [file.id, file]));
  const blobs = backup.files.map(file => {
    const meta = metadata.get(file.id);
    if (!meta || seen.has(file.id) || typeof file.base64 !== 'string' || file.base64.length !== Math.ceil(meta.size / 3) * 4 || /[^A-Za-z0-9+/]/.test(file.base64.replace(/={1,2}$/, ''))) throw new Error('Invalid attachment data.');
    seen.add(file.id);
    const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
    if (bytes.length !== meta.size) throw new Error('Attachment size mismatch.');
    return { id: file.id, blob: new Blob([bytes], { type: meta.type }) };
  });
  return { data, blobs };
}
