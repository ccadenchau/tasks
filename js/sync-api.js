const ROOT = 'https://api.cadenchau.com/api/v1/collections';
const COLLECTION = 'tasks_cadenchau_com';
const CHUNK_SIZE = 192 * 1024;

export function createSyncApi(authorization, fetcher = globalThis.fetch.bind(globalThis)) {
  async function request(path, method = 'GET', value) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (!authorization) throw new Error('Sign in to sync.');
      const response = await fetcher(`${ROOT}${path}`, {
        method, credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Authorization: authorization, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
      if (!response.ok) { const error = new Error(response.status === 401 ? 'Sign in again to sync. Reload this page.' : `Cloud sync failed (${response.status}). Click to retry.`); error.status = response.status; throw error; }
      return response.json();
    } finally { clearTimeout(timeout); }
  }
  const entry = key => `/${COLLECTION}/entry?key=${encodeURIComponent(key)}`;
  return {
    signOut() { authorization = ''; },
    async keys() {
      const keys = [];
      for (let offset = 0; ; offset += 1000) {
        let page;
        try { page = await request(`/${COLLECTION}/keys?offset=${offset}&limit=1000`); }
        catch (error) {
          if (error.status !== 404 || offset) throw error;
          try { await request('', 'POST', { name: COLLECTION }); } catch (createError) { if (createError.status !== 409) throw createError; }
          return [];
        }
        if (!Array.isArray(page) || page.some(key => typeof key !== 'string')) throw new Error('Invalid cloud collection.');
        keys.push(...page);
        if (page.length < 1000) return keys;
      }
    },
    read: key => request(entry(key)),
    write: (key, value) => request(entry(key), 'PUT', value),
    async uploadFile(file, blob) {
      if (!blob || blob.size !== file.size) throw new Error(`Missing attachment: ${file.name}`);
      for (let index = 0; index < Math.max(1, Math.ceil(blob.size / CHUNK_SIZE)); index++) {
        const bytes = new Uint8Array(await blob.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE).arrayBuffer()), parts = [];
        for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
        await request(entry(`file_${file.id}_${index}`), 'PUT', btoa(parts.join('')));
      }
    },
    async downloadFile(file) {
      const parts = [];
      for (let index = 0; index < Math.max(1, Math.ceil(file.size / CHUNK_SIZE)); index++) {
        const encoded = await request(entry(`file_${file.id}_${index}`));
        if (typeof encoded !== 'string' || encoded.length > Math.ceil(CHUNK_SIZE / 3) * 4) throw new Error('Invalid cloud attachment.');
        parts.push(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)));
      }
      const blob = new Blob(parts, { type: file.type });
      if (blob.size !== file.size) throw new Error('Cloud attachment size mismatch.');
      return blob;
    },
  };
}
