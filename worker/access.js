import { createRemoteJWKSet, jwtVerify } from 'jose';

const resolvers = new Map();

export function accessSettings(env) {
  const domain = env.ACCESS_TEAM_DOMAIN || '';
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain) || !env.ACCESS_AUD || !env.ACCESS_ALLOWED_EMAIL) return null;
  return { issuer: `https://${domain.toLowerCase()}`, audience: env.ACCESS_AUD, email: env.ACCESS_ALLOWED_EMAIL.trim().toLowerCase() };
}

export async function verifyAccess(request, settings) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) return false;
  let keys = resolvers.get(settings.issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${settings.issuer}/cdn-cgi/access/certs`));
    resolvers.set(settings.issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: settings.issuer, audience: settings.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'email'] });
    return typeof payload.email === 'string' && payload.email.toLowerCase() === settings.email;
  } catch { return false; }
}
