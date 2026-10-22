// Browser-facing files the Tide SDK needs on the web app's origin, and the dev check page.
//
// The Tide pack's "Browser Prerequisites": the DPoP relay page at the wildcard path
// /tide_dpop/iss/<hex>/aud/<hex>/tide_dpop_auth.html with its own CSP and Allow-CSP-From: *,
// silent-check-sso.html, and an /auth/redirect page that processes the login callback. The relay
// page and its headers come from Tide's own resolver (@tidecloak/js/dpop-server), byte-exact.
import express from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, normalize, sep } from 'node:path';
import { expectationsFromConfig, resolveDpopAuthRequest } from '@tidecloak/js/dpop-server';
import type { TideAdapterConfig } from './auth/tide.ts';

export interface TidePagesOptions {
  /** Undefined until tidecloak/setup.sh phase2 has exported it. */
  adapter?: TideAdapterConfig;
  /** Serve the dev check page (/dev) and the SDK modules it loads. Never in production. */
  devTools: boolean;
  serverDir: string;
  repoRoot: string;
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

// A page that hosts the Tide enclave must allow it in frames (frame-src *). No frame-ancestors:
// the enclave frames this origin for silent sign-in and the approval pop-up.
const ENCLAVE_HOST_CSP = "frame-src 'self' *";

/**
 * Serves the SDK's ES modules from node_modules for the dev page's import map. Tide's packages use
 * extensionless relative imports ('./Clients'), which browsers cannot resolve, so those requests
 * are redirected to the real file; the browser then resolves that module's own imports from the
 * redirected URL.
 */
function sdkModules(nodeModules: string, packages: string[]): express.RequestHandler {
  const files = express.static(nodeModules, { index: false, fallthrough: false });
  return (req, res, next) => {
    const path = decodeURIComponent(req.path);
    const file = normalize(join(nodeModules, path));
    if (!file.startsWith(nodeModules + sep) || !packages.some((p) => path.startsWith(`/${p}/`))) {
      return void res.status(404).end();
    }
    if (!isFile(file)) {
      if (isFile(`${file}.js`)) return void res.redirect(302, `${req.baseUrl}${path}.js`);
      if (isFile(join(file, 'index.js'))) return void res.redirect(302, `${req.baseUrl}${path}/index.js`);
    }
    files(req, res, next);
  };
}

export function mountTidePages(app: express.Express, opts: TidePagesOptions): void {
  const nodeModules = join(opts.serverDir, 'node_modules');
  const sdkDir = join(nodeModules, '@tidecloak', 'js');
  const { issuer, client } = expectationsFromConfig(opts.adapter ?? {});

  app.use('/tide_dpop', (req, res, next) => {
    const result = resolveDpopAuthRequest({ pathname: req.originalUrl, expectedIssuer: issuer, expectedClient: client, method: req.method });
    if (!result) return next();
    res.status(result.status).set(result.headers).send(result.body ?? '');
  });

  app.get('/silent-check-sso.html', (_req, res) => res.sendFile(join(sdkDir, 'silent-check-sso.html')));

  // The adapter config is public: the browser SDK needs it, and it holds only public keys and ids.
  app.get('/tidecloak.json', (_req, res) => {
    if (opts.adapter) res.json(opts.adapter);
    else res.status(404).json({ error: 'TideCloak is not set up yet: run bash tidecloak/setup.sh phase2' });
  });

  if (!opts.devTools) return;

  app.use('/vendor', sdkModules(nodeModules, ['@tidecloak/js', '@tideorg/js', 'heimdall-tide']));

  // secureShare.ts, type-stripped so the dev page can load it without a bundler. The web app
  // (Member 1) imports the same file through its own build.
  app.get('/web-lib/secureShare.js', (_req, res) => {
    const source = join(opts.repoRoot, 'web', 'src', 'lib', 'secureShare.ts');
    if (!isFile(source)) return void res.status(404).type('text/plain').send('web/src/lib/secureShare.ts not found');
    res.type('text/javascript').set('Cache-Control', 'no-store').send(stripTypeScriptTypes(readFileSync(source, 'utf8')));
  });

  const devDir = join(opts.serverDir, 'devtools');
  const page = (_req: express.Request, res: express.Response) =>
    res.set('Content-Security-Policy', ENCLAVE_HOST_CSP).set('Cache-Control', 'no-store').sendFile(join(devDir, 'index.html'));
  app.get(['/dev', '/dev/', '/auth/redirect'], page);
  app.use('/dev', express.static(devDir, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
  app.get('/', (_req, res) => res.redirect('/dev/'));
}
