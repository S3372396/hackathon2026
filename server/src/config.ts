// Runtime settings, from the repo-root .env (gitignored) and the environment. Only index.ts and
// reset.ts read this; tests build the app with explicit settings.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: process.env.DB_PATH ?? resolve(repoRoot, 'server/data/journal.db'),
};
