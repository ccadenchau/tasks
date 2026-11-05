import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordAuthorization } from '../js/sign-in.js';
import { createSyncApi } from '../js/sync-api.js';

test('password authorization encodes the API username and Unicode password', () => {
  const authorization = passwordAuthorization('test-✓-password');
  assert(authorization.startsWith('Basic '));
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(authorization.slice(6)), char => char.charCodeAt(0))), 'admin:test-✓-password');
});

test('sign-out drops the in-memory credential and prevents further network requests', async () => {
  let requests = 0;
  const api = createSyncApi(passwordAuthorization('auth-test-only'), async () => { requests++; return Response.json([]); });
  await api.keys(); assert.equal(requests, 1);
  api.signOut();
  await assert.rejects(api.keys(), /Sign in/);
  assert.equal(requests, 1);
});

test('an incorrect password fails authentication without creating or writing a collection', async () => {
  const methods = [];
  const api = createSyncApi(passwordAuthorization('incorrect-test-only'), async (url, options) => {
    methods.push(options.method);
    assert.equal(new URL(url).origin, 'https://api.cadenchau.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    return Response.json({}, { status: 401 });
  });
  await assert.rejects(api.keys(), error => error.status === 401);
  assert.deepEqual(methods, ['GET']);
});
