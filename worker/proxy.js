const UPSTREAM = 'https://api.cadenchau.com/api/v1/collections';
const COLLECTION = 'tasks_cadenchau_com';
const PREFIX = '/api/sync';
const MAX_BODY = 1024 * 1024;

export const jsonError = (message, status) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

function target(request) {
  const url = new URL(request.url), path = url.pathname.slice(PREFIX.length), method = request.method;
  if (path === '' && method === 'POST' && !url.search) return { path: '', create: true };
  if (path === `/${COLLECTION}/keys` && method === 'GET') {
    if ([...url.searchParams.keys()].some(key => !['offset', 'limit'].includes(key))) return null;
    for (const key of ['offset', 'limit']) if (url.searchParams.getAll(key).length > 1) return null;
    const offset = url.searchParams.get('offset') || '0', limit = url.searchParams.get('limit') || '1000';
    if (!/^\d+$/.test(offset) || !/^\d+$/.test(limit) || !Number.isSafeInteger(Number(offset)) || Number(limit) < 1 || Number(limit) > 1000) return null;
    return { path: `/${COLLECTION}/keys?offset=${offset}&limit=${limit}` };
  }
  if (path === `/${COLLECTION}/entry` && ['GET', 'PUT'].includes(method)) {
    if ([...url.searchParams.keys()].some(key => key !== 'key') || url.searchParams.getAll('key').length !== 1) return null;
    const key = url.searchParams.get('key');
    if (!key || key.length > 1024 || !/^(checklist_|file_)/.test(key)) return null;
    return { path: `/${COLLECTION}/entry?key=${encodeURIComponent(key)}` };
  }
  return null;
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('content-type');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw new Error('size');
  const reader = request.body?.getReader(), parts = []; let size = 0;
  if (!reader) throw new Error('json');
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('size'); }
    parts.push(value);
  }
  return JSON.parse(await new Blob(parts).text());
}

export async function proxySync(request, env, fetcher = fetch) {
  const url = new URL(request.url), origin = request.headers.get('Origin');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== url.origin) || (['POST', 'PUT'].includes(request.method) && origin !== url.origin)) return jsonError('Forbidden origin.', 403);
  const route = target(request);
  if (!route) return jsonError('Not found.', 404);
  if (!env.API_AUTHORIZATION) return jsonError('Sync secret is not configured.', 503);
  let body;
  if (['POST', 'PUT'].includes(request.method)) {
    try { const value = await readJson(request); body = JSON.stringify(route.create ? { name: COLLECTION } : value); }
    catch (error) { return jsonError(error.message === 'size' ? 'Request is too large.' : 'Expected JSON.', error.message === 'size' ? 413 : 400); }
  }
  try {
    const response = await fetcher(`${UPSTREAM}${route.path}`, {
      method: request.method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: env.API_AUTHORIZATION, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok) return jsonError('Upstream sync request failed.', response.status);
    if (!response.headers.get('Content-Type')?.includes('application/json')) return jsonError('Invalid upstream response.', 502);
    return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return jsonError('Sync service unavailable.', 502); }
}
