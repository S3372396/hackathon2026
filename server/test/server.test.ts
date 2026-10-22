// Runs the real entry points (src/index.ts, src/reset.ts) as separate Node processes.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'journal-test-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

function runReset(dbPath: string, ...args: string[]) {
  return spawnSync(process.execPath, ['src/reset.ts', ...args], {
    cwd: serverDir, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
  });
}

describe('reset script', () => {
  it('seeds a fresh database and is repeatable', () => {
    const dbPath = join(tempDir, 'reset.db');
    for (let run = 0; run < 2; run++) {
      const result = runReset(dbPath);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('users: 3 (0 with a Tide key), entries: 0, shares: 0, audit events: 0');
    }
  });
});

describe('server', () => {
  it('starts, seeds an empty database, answers /health, and fails closed without TideCloak', async () => {
    const child = spawn(process.execPath, ['src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, DB_PATH: join(tempDir, 'start.db'), PORT: '0', TIDECLOAK_ADAPTER: join(tempDir, 'missing.json') },
    });
    let errors = '';
    child.stderr.on('data', (chunk) => { errors += chunk; });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += chunk;
          const match = out.match(/localhost:(\d+)/);
          if (match) resolve(Number(match[1]));
        });
        child.on('exit', (code) => reject(new Error(`server exited with ${code}: ${out}${errors}`)));
      });
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, users: 3 });
      // No adapter exported: no realm key to check tokens against, so the API refuses everyone.
      const api = await fetch(`http://localhost:${port}/api/me`);
      expect(api.status).toBe(401);
      expect(errors).toContain('every /api call is refused');
    } finally {
      // Wait for the exit, or Windows keeps the database file locked and the cleanup fails.
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
  });
});
