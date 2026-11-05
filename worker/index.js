import { accessSettings, verifyAccess } from './access.js';
import { jsonError, proxySync } from './proxy.js';

export function createWorker({ authenticate = verifyAccess, upstream = fetch } = {}) {
  return {
    async fetch(request, env) {
      const settings = accessSettings(env);
      if (!settings) return jsonError('Cloudflare Access is not configured.', 503);
      if (!await authenticate(request, settings)) return jsonError('Sign in with your authorized Cloudflare Access account.', 401);
      const path = new URL(request.url).pathname;
      if (path === '/api/sync' || path.startsWith('/api/sync/')) return proxySync(request, env, upstream);
      if (!['GET', 'HEAD'].includes(request.method)) return jsonError('Method not allowed.', 405);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'same-origin');
      return response;
    },
  };
}

export default createWorker();
