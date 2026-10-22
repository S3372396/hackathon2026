// The Express app. Dependencies are passed in, so tests can use an in-memory database and a fake
// authenticator. Every /api route takes the caller's identity and role from a verified token,
// checked on the server; nothing the client sends about itself is trusted.
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db.ts';
import { transaction } from './db.ts';
import * as store from './store.ts';
import type { StoredUser } from './store.ts';
import type { AuditEvent, EntryUpload, Role, Share } from '../../contract/types.ts';

/** The caller's identity, taken from a verified token. */
export interface Principal {
  username: string;
  roles: string[];
  tideUserKey?: string;
}

/** Resolves the caller's verified identity, or null if the request is not authenticated. */
export type Authenticate = (req: Request) => Promise<Principal | null>;

export interface AppDeps {
  db: Db;
  authenticate: Authenticate;
  now?: () => Date;
  /** Origin of the web app, allowed to call the API cross-origin (CORS). */
  webOrigin?: string;
  /** Sent with 401 responses, e.g. the DPoP challenge. */
  wwwAuthenticate?: string;
  /** Adds non-API routes (the Tide browser pages) before the error handlers. */
  mount?: (app: express.Express) => void;
  /** The realm's tide-realm-admin policy (base64), which signing a share's policies needs. */
  adminPolicy?: () => string | undefined;
  /**
   * DEV ONLY: adds GET /api/dev/compromised/package/:id, which hands any signed-in user any stored
   * package, as a compromised server would. Used to show the Tide network still refuses them.
   */
  simulateCompromisedServer?: boolean;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const ENTRY_TYPES = ['habit', 'mood', 'symptom'];
const PLAINTEXT_FIELDS = ['title', 'value', 'notes'];

const isDate = (v: unknown): v is string => typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v));
const isText = (v: unknown, max = 1_000_000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function parseEntryUpload(body: unknown): EntryUpload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body must be a JSON object');
  const b = body as Record<string, unknown>;
  const leaked = PLAINTEXT_FIELDS.filter((f) => f in b);
  if (leaked.length) throw new HttpError(400, `send encrypted entries only (use encryptEntry); found plaintext field(s): ${leaked.join(', ')}`);
  if (!ENTRY_TYPES.includes(b.type as string)) throw new HttpError(400, 'type must be habit, mood or symptom');
  if (!isDate(b.loggedAt)) throw new HttpError(400, 'loggedAt must be an ISO date');
  if (!isText(b.ciphertext)) throw new HttpError(400, 'ciphertext is required');
  return { type: b.type as EntryUpload['type'], loggedAt: b.loggedAt, ciphertext: b.ciphertext };
}

function parseCreateShare(db: Db, patient: StoredUser, body: unknown, now: Date): store.NewShare {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body must be a JSON object');
  const b = body as Record<string, unknown>;

  const recipient = typeof b.recipientId === 'string' ? store.getUserById(db, b.recipientId) : undefined;
  if (!recipient || recipient.role !== 'professional') throw new HttpError(400, 'recipientId must be a professional');

  const ids = b.entryIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
    throw new HttpError(400, 'entryIds must be a non-empty array of entry ids');
  }
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'entryIds contains duplicates');
  const notYours = ids.filter((id) => store.getEntry(db, id)?.patientId !== patient.id);
  if (notYours.length) throw new HttpError(400, `unknown entry ids: ${notYours.join(', ')}`);

  if (!isDate(b.expiresAt) || Date.parse(b.expiresAt) <= now.getTime()) throw new HttpError(400, 'expiresAt must be a future ISO date');
  for (const key of ['rangeFrom', 'rangeTo'] as const) {
    if (b[key] !== undefined && !isDate(b[key])) throw new HttpError(400, `${key} must be an ISO date`);
  }
  if (isDate(b.rangeFrom) && isDate(b.rangeTo) && Date.parse(b.rangeFrom) > Date.parse(b.rangeTo)) {
    throw new HttpError(400, 'rangeFrom must not be after rangeTo');
  }

  const p = b.package as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') throw new HttpError(400, 'package is required (from protectEntries)');
  if (!isText(p.packageId, 200) || !isText(p.ciphertext) || !isText(p.recipientPolicy, 100_000)) {
    throw new HttpError(400, 'package must have packageId, ciphertext and recipientPolicy');
  }
  if (p.recipientId !== recipient.id || !isDate(p.expiresAt) || Date.parse(p.expiresAt) !== Date.parse(b.expiresAt)) {
    throw new HttpError(400, 'package does not match the share (recipientId or expiresAt differ)');
  }
  if (store.packageIdExists(db, p.packageId)) throw new HttpError(409, 'packageId is already used');

  return {
    patientId: patient.id,
    recipientId: recipient.id,
    entryIds: ids as string[],
    expiresAt: b.expiresAt,
    rangeFrom: b.rangeFrom as string | undefined,
    rangeTo: b.rangeTo as string | undefined,
    package: {
      packageId: p.packageId,
      recipientId: recipient.id,
      expiresAt: b.expiresAt,
      ciphertext: p.ciphertext,
      recipientPolicy: p.recipientPolicy,
    },
  };
}

export function createApp({
  db, authenticate, now = () => new Date(), webOrigin, wwwAuthenticate, mount, adminPolicy, simulateCompromisedServer,
}: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');

  const me = (res: Response): StoredUser => res.locals.user as StoredUser;
  const requireRole = (user: StoredUser, role: Role) => {
    if (user.role !== role) throw new HttpError(403, `only a ${role} can do this`);
  };
  const audit = (share: Share, action: AuditEvent['action'], actorId: string) =>
    store.addAudit(db, { patientId: share.patientId, shareId: share.id, action, actorId, at: now().toISOString() });
  /** Records a denied attempt on a share, then returns the 403 to throw. */
  const deny = (share: Share, user: StoredUser, reason: string) => {
    audit(share, 'denied', user.id);
    return new HttpError(403, reason);
  };
  const findShare = (id: string): Share => {
    store.expireDueShares(db, now());
    const share = store.getShare(db, id);
    if (!share) throw new HttpError(404, 'no such share');
    return share;
  };

  app.get('/health', (_req, res) => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    res.json({ ok: true, users: n });
  });

  if (webOrigin) {
    app.use('/api', (req, res, next) => {
      if (req.headers.origin === webOrigin) {
        res.setHeader('Access-Control-Allow-Origin', webOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, DPoP, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'DPoP-Nonce, WWW-Authenticate');
        res.setHeader('Access-Control-Max-Age', '600');
        if (req.method === 'OPTIONS') return void res.status(204).end();
      }
      next();
    });
  }

  // Authentication first, so an anonymous caller gets 401 before anything else is looked at.
  app.use('/api', async (req, res, next) => {
    const principal = await authenticate(req);
    if (!principal) {
      if (wwwAuthenticate) res.setHeader('WWW-Authenticate', wwwAuthenticate);
      throw new HttpError(401, 'sign in required');
    }
    const user = store.getUserByUsername(db, principal.username);
    if (!user) throw new HttpError(403, 'not a user of this app');
    if (!principal.roles.includes(user.role)) throw new HttpError(403, `your sign-in does not carry the ${user.role} role`);
    if (principal.tideUserKey && principal.tideUserKey !== user.tideUserKey) {
      store.setTideUserKey(db, user.id, principal.tideUserKey);
      user.tideUserKey = principal.tideUserKey;
    }
    res.locals.user = user;
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));

  app.get('/api/me', (_req, res) => {
    res.json(store.publicUser(me(res)));
  });

  app.get('/api/professionals', (_req, res) => {
    requireRole(me(res), 'patient');
    res.json(store.listProfessionals(db).map(store.publicUser));
  });

  app.get('/api/entries', (_req, res) => {
    const user = me(res);
    requireRole(user, 'patient');
    res.json(store.listEntries(db, user.id));
  });

  app.post('/api/entries', (req, res) => {
    const user = me(res);
    requireRole(user, 'patient');
    res.status(201).json(store.insertEntry(db, user.id, parseEntryUpload(req.body), now()));
  });

  // The contract's table lists PUT /api/entries with no id in the path, so the id travels in the
  // body, as in Member 1's mock API.
  app.put('/api/entries', (req, res) => {
    const user = me(res);
    requireRole(user, 'patient');
    const id = (req.body as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'id is required');
    const entry = store.getEntry(db, id);
    if (!entry) throw new HttpError(404, 'no such entry');
    if (entry.patientId !== user.id) throw new HttpError(403, 'not your entry');
    const { id: _id, ...upload } = req.body as Record<string, unknown>;
    res.json(store.updateEntry(db, entry.id, parseEntryUpload(upload), now()));
  });

  app.post('/api/shares', (req, res) => {
    const user = me(res);
    requireRole(user, 'patient');
    const share = transaction(db, () => {
      const created = store.insertShare(db, parseCreateShare(db, user, req.body, now()), now());
      audit(created, 'created', user.id);
      return created;
    });
    res.status(201).json(share);
  });

  app.get('/api/shares', (_req, res) => {
    const user = me(res);
    store.expireDueShares(db, now());
    res.json(user.role === 'patient' ? store.listSharesByPatient(db, user.id) : store.listSharesByRecipient(db, user.id));
  });

  app.get('/api/shares/:id/package', (req, res) => {
    const user = me(res);
    store.expireDueShares(db, now());
    const share = store.getShare(db, req.params.id);
    // Unknown ids get the same 403 as a refused share, so share ids cannot be probed.
    if (!share) throw new HttpError(403, 'access denied');
    // The patient looking at their own share is not a denied attempt worth auditing.
    if (user.id === share.patientId) throw new HttpError(403, 'only the recipient can open a package');
    if (user.role !== 'professional') throw deny(share, user, 'only the recipient can open a package');
    if (share.recipientId !== user.id) throw deny(share, user, 'this share is not addressed to you');
    if (share.status !== 'active') throw deny(share, user, `this share has been ${share.status}`);
    const pkg = store.getSharePackage(db, share.id);
    if (!pkg) throw deny(share, user, 'this package is no longer available');
    audit(share, 'viewed', user.id);
    res.json(pkg);
  });

  app.post('/api/shares/:id/withdraw', (req, res) => {
    const user = me(res);
    requireRole(user, 'patient');
    const share = findShare(req.params.id);
    if (share.patientId !== user.id) throw new HttpError(404, 'no such share');
    // Repeatable: withdrawing a share that is already withdrawn or expired changes nothing.
    if (share.status !== 'active') return void res.json(share);
    const withdrawn = transaction(db, () => {
      const updated = store.withdrawShare(db, share.id);
      audit(updated, 'withdrawn', user.id);
      return updated;
    });
    res.json(withdrawn);
  });

  app.get('/api/audit', (_req, res) => {
    const user = me(res);
    requireRole(user, 'patient');
    store.expireDueShares(db, now());
    res.json(store.listAudit(db, user.id));
  });

  // Used by secureShare.ts only. The admin policy is public data: it authorises nothing by itself.
  app.get('/api/tide/admin-policy', (_req, res) => {
    requireRole(me(res), 'patient');
    const policy = adminPolicy?.();
    if (!policy) throw new HttpError(503, 'sharing is not set up yet: run bash tidecloak/setup.sh phase3');
    res.json({ policy });
  });

  if (simulateCompromisedServer) {
    app.get('/api/dev/compromised/shares', (_req, res) => {
      res.json(db.prepare('SELECT id, recipient_id AS recipientId, status FROM shares ORDER BY created_at DESC').all());
    });
    app.get('/api/dev/compromised/package/:id', (req, res) => {
      const pkg = store.getSharePackage(db, req.params.id);
      if (!pkg) throw new HttpError(404, 'no stored package for that share (withdrawn, expired or unknown)');
      res.json(pkg);
    });
  }

  app.use('/api', () => {
    throw new HttpError(404, 'no such endpoint');
  });

  mount?.(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') return void res.status(400).json({ error: 'invalid JSON' });
    if (type === 'entity.too.large') return void res.status(413).json({ error: 'request body too large' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
