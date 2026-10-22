// The Express app. Dependencies are passed in, so tests can use an in-memory database.
import express from 'express';
import type { Db } from './db.ts';

export interface AppDeps {
  db: Db;
}

export function createApp({ db }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    res.json({ ok: true, users: n });
  });

  return app;
}
