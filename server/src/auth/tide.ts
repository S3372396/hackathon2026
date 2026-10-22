// Verifies TideCloak access tokens and their DPoP proofs, with node:crypto only.
//
// Follows the Tide agent pack's playbook verify-jwt-server-side and its tested verifier
// templates/dpop-verify/verifyDpop.ts (which uses `jose`; this is the same set of checks):
//   token: signature by the key embedded in the adapter config (never a remote JWKS), issuer, azp,
//          exp/nbf/iat, and a cnf.jkt binding;
//   proof: DPoP auth scheme, typ dpop+jwt, ES256 or EdDSA, signed by the key in its own header,
//          that key's thumbprint equal to cnf.jkt, ath = hash of this token, htm, htu, iat, unused jti.
import { createHash, createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { Authenticate, Principal } from '../app.ts';

export interface TideAdapterConfig {
  realm: string;
  'auth-server-url': string;
  resource: string;
  jwk: { keys: JsonWebKey[] };
  vendorId?: string;
  homeOrkUrl?: string;
}

export class AuthError extends Error {}

type Claims = Record<string, unknown>;

const b64url = (s: string) => Buffer.from(s, 'base64url');

function decodeJws(jws: string) {
  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new AuthError('not a compact JWS');
  try {
    return {
      header: JSON.parse(b64url(parts[0]).toString('utf8')) as Claims,
      payload: JSON.parse(b64url(parts[1]).toString('utf8')) as Claims,
      signingInput: Buffer.from(`${parts[0]}.${parts[1]}`),
      signature: b64url(parts[2]),
    };
  } catch {
    throw new AuthError('JWS header or payload is not JSON');
  }
}

/** Verifies a JWS signature for the algorithms TideCloak uses. */
function verifySignature(alg: unknown, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  if (alg === 'EdDSA' && key.asymmetricKeyType === 'ed25519') return verify(null, data, key, signature);
  if (alg === 'ES256' && key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
    return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature);
  }
  return false;
}

/** RFC 7638 JWK thumbprint (SHA-256, base64url). */
export function jwkThumbprint(jwk: JsonWebKey): string {
  let canonical: string;
  if (jwk.kty === 'EC') canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  else if (jwk.kty === 'OKP') canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  else throw new AuthError(`unsupported DPoP key type ${String(jwk.kty)}`);
  return createHash('sha256').update(canonical).digest('base64url');
}

/** One-process replay cache for DPoP `jti`s. Fine for this single-server prototype only. */
export class MemoryJtiStore {
  private seen = new Map<string, number>();
  claim(jti: string, expiresAtMs: number, nowMs: number): boolean {
    for (const [k, exp] of this.seen) if (exp < nowMs) this.seen.delete(k);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expiresAtMs);
    return true;
  }
}

export interface TideVerifierOptions {
  adapter: TideAdapterConfig;
  /** Origins the browser may call the API from (direct, or through the web app's dev proxy). */
  publicOrigins: string[];
  now?: () => Date;
  clockSkewSeconds?: number;
  /** DPoP proof iat window. Default 300 s, as in Tide's verifier. */
  dpopIatWindowSeconds?: number;
  jtiStore?: MemoryJtiStore;
}

export interface TideRequest {
  method: string;
  /** Path the client requested, without the query string, e.g. /api/me */
  path: string;
  authorization?: string;
  dpop?: string;
}

export function createTideVerifier(opts: TideVerifierOptions) {
  const { adapter } = opts;
  if (!adapter?.jwk?.keys?.length) {
    throw new Error('Adapter config has no embedded jwk: export it with the Tide provider (providerId=keycloak-oidc-keycloak-json).');
  }
  const issuer = `${adapter['auth-server-url'].replace(/\/+$/, '')}/realms/${adapter.realm}`;
  const realmKeys = adapter.jwk.keys.map((jwk) => ({ jwk, key: createPublicKey({ key: jwk, format: 'jwk' }) }));
  const now = opts.now ?? (() => new Date());
  const skew = opts.clockSkewSeconds ?? 30;
  const iatWindow = opts.dpopIatWindowSeconds ?? 300;
  const jtis = opts.jtiStore ?? new MemoryJtiStore();
  const origins = opts.publicOrigins.map((o) => o.replace(/\/+$/, ''));

  function verifyAccessToken(token: string): Claims {
    const { header, payload, signingInput, signature } = decodeJws(token);
    const candidates = realmKeys.filter(({ jwk }) => !header.kid || !jwk.kid || jwk.kid === header.kid);
    if (!candidates.some(({ key }) => verifySignature(header.alg, key, signingInput, signature))) {
      throw new AuthError('token signature is not from this realm');
    }
    if (payload.iss !== issuer) throw new AuthError('token issuer does not match');
    if (payload.azp !== adapter.resource) throw new AuthError('token was not issued to this client');
    const t = Math.floor(now().getTime() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp + skew < t) throw new AuthError('token expired');
    if (typeof payload.nbf === 'number' && payload.nbf - skew > t) throw new AuthError('token not valid yet');
    if (typeof payload.iat === 'number' && payload.iat - 60 > t) throw new AuthError('token issued in the future');
    return payload;
  }

  function verifyDpop(req: TideRequest, token: string, claims: Claims): void {
    const jkt = (claims.cnf as { jkt?: unknown } | undefined)?.jkt;
    // The realm issues DPoP-bound tokens only. An unbound token is a misconfigured client or a downgrade.
    if (typeof jkt !== 'string' || !jkt) throw new AuthError('token is not DPoP-bound (no cnf.jkt)');
    if (!req.dpop) throw new AuthError('missing DPoP proof');

    const { header, payload, signingInput, signature } = decodeJws(req.dpop);
    if (header.typ !== 'dpop+jwt') throw new AuthError('DPoP proof typ must be dpop+jwt');
    if (header.alg !== 'ES256' && header.alg !== 'EdDSA') throw new AuthError('DPoP proof alg must be ES256 or EdDSA');
    const jwk = header.jwk as JsonWebKey | undefined;
    if (!jwk || typeof jwk !== 'object' || 'd' in jwk) throw new AuthError('DPoP proof must carry a public jwk');
    let key: KeyObject;
    try {
      key = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      throw new AuthError('DPoP proof jwk is not a valid public key');
    }
    // Verify with the key the proof carries, not the realm key.
    if (!verifySignature(header.alg, key, signingInput, signature)) throw new AuthError('DPoP proof signature invalid');
    if (jwkThumbprint(jwk) !== jkt) throw new AuthError('DPoP proof key is not the key this token is bound to');
    if (payload.ath !== createHash('sha256').update(token).digest('base64url')) throw new AuthError('DPoP proof is for another token (ath)');
    if (typeof payload.htm !== 'string' || payload.htm.toUpperCase() !== req.method.toUpperCase()) throw new AuthError('DPoP proof htm does not match');
    if (!origins.some((origin) => payload.htu === `${origin}${req.path}`)) throw new AuthError('DPoP proof htu does not match');
    const t = now().getTime() / 1000;
    if (typeof payload.iat !== 'number' || Math.abs(t - payload.iat) > iatWindow) throw new AuthError('DPoP proof iat outside the window');
    if (typeof payload.jti !== 'string' || !payload.jti) throw new AuthError('DPoP proof has no jti');
    if (!jtis.claim(payload.jti, now().getTime() + iatWindow * 1000, now().getTime())) throw new AuthError('DPoP proof replayed (jti)');
  }

  /** The caller's verified identity. Throws AuthError if the token or proof does not hold. */
  function verifyRequest(req: TideRequest): Principal {
    const match = /^DPoP (\S+)$/.exec(req.authorization ?? '');
    // A DPoP-bound token presented as Bearer is exactly the stolen-token replay DPoP exists to stop.
    if (!match) throw new AuthError('expected Authorization: DPoP <token>');
    const token = match[1];
    const claims = verifyAccessToken(token);
    verifyDpop(req, token, claims);
    if (typeof claims.preferred_username !== 'string') throw new AuthError('token has no username');
    const roles = (claims.realm_access as { roles?: unknown } | undefined)?.roles;
    return {
      username: claims.preferred_username,
      roles: Array.isArray(roles) ? roles.map(String) : [],
      tideUserKey: typeof claims.tideuserkey === 'string' ? claims.tideuserkey : undefined,
    };
  }

  return { issuer, verifyAccessToken, verifyRequest };
}

/** The Express adapter: resolves to the verified principal, or null (the app answers 401). */
export function tideAuthenticator(opts: TideVerifierOptions, log: (msg: string) => void = () => {}): Authenticate {
  const verifier = createTideVerifier(opts);
  return async (req) => {
    try {
      return verifier.verifyRequest({
        method: req.method,
        path: req.originalUrl.split('?')[0],
        authorization: req.headers.authorization,
        dpop: typeof req.headers.dpop === 'string' ? req.headers.dpop : undefined,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        log(`401 ${req.method} ${req.originalUrl.split('?')[0]}: ${err.message}`);
        return null;
      }
      throw err;
    }
  };
}
