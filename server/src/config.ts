// Runtime settings, from the repo-root .env (gitignored) and the environment. Only index.ts and
// reset.ts read this; tests build the app with explicit settings.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const serverDir = fileURLToPath(new URL('..', import.meta.url));

const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const list = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'server/data/journal.db'),
  /** Exported by tidecloak/setup.sh phase2. */
  adapterPath: process.env.TIDECLOAK_ADAPTER ?? resolve(repoRoot, 'tidecloak/tidecloak.json'),
  /** Exported by tidecloak/setup.sh phase3; needed to sign share policies. */
  adminPolicyPath: process.env.TIDE_ADMIN_POLICY ?? resolve(repoRoot, 'tidecloak/admin-policy.json'),
  /** The web app's origin, allowed to call the API cross-origin. */
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  /** Origins a browser may call the API from; a DPoP proof must name one of them. */
  publicOrigins: list(process.env.PUBLIC_ORIGINS ?? 'http://localhost:3001,http://localhost:5173'),
  devTools: (process.env.DEV_TOOLS ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
};
