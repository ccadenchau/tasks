import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { accessSettings, verifyAccess } from '../worker/access.js';
import { createWorker } from '../worker/index.js';
import { proxySync } from '../worker/proxy.js';

const env = {
  ACCESS_TEAM_DOMAIN: 'checklist-test.cloudflareaccess.com', ACCESS_AUD: 'test-audience', ACCESS_ALLOWED_EMAIL: 'owner@example.com',
  API_AUTHORIZATION: 'test-server-secret', ASSETS: { fetch: async () => new Response('<h1>Tasks</h1>', { headers: { 'Content-Type': 'text/html' } }) },
};
const origin = 'https://tasks.cadenchau.com';
const entry = '/api/sync/tasks_cadenchau_com/entry?key=checklist_test';
const request = (path = '/', options = {}) => new Request(`${origin}${path}`, options);
const write = (body = { title: 'Task' }) => ({ method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('Worker denies assets and sync before authentication and fails closed without configuration', async () => {
  let touched = false;
  const worker = createWorker({ upstream: async () => { touched = true; throw new Error('Unexpected request'); } });
  assert.equal((await worker.fetch(request(), env)).status, 401);
  assert.equal((await worker.fetch(request(entry, write()), env)).status, 401);
  assert.equal((await worker.fetch(request(), { ...env, ACCESS_AUD: '' })).status, 503);
  assert.equal((await worker.fetch(request(), { ...env, ACCESS_TEAM_DOMAIN: 'attacker.example' })).status, 503);
  assert.equal(touched, false);
});

test('Access validates real signatures, owner email, issuer, audience, and expiration', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  };
  const settings = accessSettings(env);
  const token = overrides => new SignJWT({ email: env.ACCESS_ALLOWED_EMAIL, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(settings.issuer).setAudience(env.ACCESS_AUD).setExpirationTime('5m');
  const authorized = value => request('/', { headers: { 'Cf-Access-Jwt-Assertion': value } });
  try {
    const valid = await token().sign(privateKey);
    assert(await verifyAccess(authorized(valid), settings));
    assert(!await verifyAccess(authorized(await token({ email: 'someone@example.com' }).sign(privateKey)), settings));
    assert(!await verifyAccess(authorized(await token().setAudience('other-app').sign(privateKey)), settings));
    assert(!await verifyAccess(authorized(await token().setIssuer('https://attacker.example').sign(privateKey)), settings));
    assert(!await verifyAccess(authorized(await token().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(privateKey)), settings));
    const parts = valid.split('.'); parts[1] = Buffer.from(JSON.stringify({ email: env.ACCESS_ALLOWED_EMAIL, exp: 9999999999, iss: settings.issuer, aud: env.ACCESS_AUD })).toString('base64url');
    assert(!await verifyAccess(authorized(parts.join('.')), settings));
    assert(!await verifyAccess(request('/', { headers: { 'Cf-Access-Authenticated-User-Email': env.ACCESS_ALLOWED_EMAIL } }), settings));
    const worker = createWorker();
    const response = await worker.fetch(authorized(valid), env);
    assert.equal(await response.text(), '<h1>Tasks</h1>');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  } finally { globalThis.fetch = originalFetch; }
});

test('proxy adds the server secret and forwards only checklist JSON without browser credentials', async () => {
  let count = 0;
  const response = await proxySync(request(entry, { ...write(), headers: { ...write().headers, Authorization: 'browser-value', Cookie: 'private-cookie', 'Cf-Access-Jwt-Assertion': 'private-session' } }), env, async (url, options) => {
    count++;
    assert.equal(url, 'https://api.cadenchau.com/api/v1/collections/tasks_cadenchau_com/entry?key=checklist_test');
    assert.equal(options.headers.Authorization, env.API_AUTHORIZATION);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['Cf-Access-Jwt-Assertion'], undefined);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { title: 'Task' });
    return Response.json({ saved: true }, { headers: { 'Set-Cookie': 'never-forward', Authorization: 'never-forward' } });
  });
  assert.equal(count, 1); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: true });
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Authorization'), null);
});

test('proxy blocks other collections, arbitrary paths, destructive methods, and cross-origin writes', async () => {
  const neverFetch = async () => { throw new Error('Upstream must not be called'); };
  for (const path of ['/api/sync/other/entry?key=checklist_test', '/api/sync/tasks_cadenchau_com/entry?key=unrelated', '/api/sync/tasks_cadenchau_com/entry?key=checklist_test&url=https://attacker.example', '/api/sync/tasks_cadenchau_com/keys?limit=1001', '/api/sync/tasks_cadenchau_com/keys?offset=-1']) {
    assert.equal((await proxySync(request(path), env, neverFetch)).status, 404);
  }
  assert.equal((await proxySync(request(entry, { method: 'DELETE' }), env, neverFetch)).status, 404);
  assert.equal((await proxySync(request(entry, { ...write(), headers: { ...write().headers, Origin: 'https://attacker.example' } }), env, neverFetch)).status, 403);
  assert.equal((await proxySync(request(entry, { ...write(), headers: { 'Content-Type': 'application/json' } }), env, neverFetch)).status, 403);
  assert.equal((await proxySync(request(entry), { ...env, API_AUTHORIZATION: '' }, neverFetch)).status, 503);
});

test('proxy bounds request bodies, fixes collection creation, and redacts upstream failures', async () => {
  assert.equal((await proxySync(request(entry, { ...write(), body: 'invalid' }), env)).status, 400);
  assert.equal((await proxySync(request(entry, { ...write(), headers: { ...write().headers, 'Content-Length': '1048577' } }), env)).status, 413);
  const response = await proxySync(request('/api/sync', { ...write({ name: 'other' }), method: 'POST' }), env, async (url, options) => {
    assert.equal(url, 'https://api.cadenchau.com/api/v1/collections');
    assert.deepEqual(JSON.parse(options.body), { name: 'tasks_cadenchau_com' });
    return Response.json({ name: 'tasks_cadenchau_com' }, { status: 201 });
  });
  assert.equal(response.status, 201);
  const failure = await proxySync(request(entry), env, async () => { throw new Error(env.API_AUTHORIZATION); });
  assert.equal(failure.status, 502); assert(!(await failure.text()).includes(env.API_AUTHORIZATION));
  const upstream = await proxySync(request(entry), env, async () => new Response(env.API_AUTHORIZATION, { status: 401 }));
  assert.equal(upstream.status, 401); assert(!(await upstream.text()).includes(env.API_AUTHORIZATION));
});

test('deployment protects every asset and excludes local secrets from Git and browser source', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  const ignored = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  for (const name of ['.dev.vars', '.dev.vars.*', '.env', '.env.*', 'dist/', '.wrangler/']) assert(ignored.split('\n').includes(name));
  const browser = await readFile(new URL('../js/sync-api.js', import.meta.url), 'utf8');
  assert(!browser.includes('AUTHORIZATION')); assert(!browser.includes('Basic ')); assert(browser.includes("'/api/sync'"));
});
