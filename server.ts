import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { db } from './src/server/db.ts';
import { createDavRouter } from './src/server/dav.ts';
import { createApiRouter } from './src/server/routes.ts';

const PORT = Number(process.env.PORT || 3000);

async function startServer(): Promise<void> {
  await db.init();

  const app = express();
  app.set('trust proxy', 1);

  // CalDAV & CardDAV service discovery redirects
  app.all('/.well-known/caldav', (_req, res) => {
    res.redirect(301, '/dav/');
  });
  app.all('/.well-known/carddav', (_req, res) => {
    res.redirect(301, '/dav/');
  });

  // CalDAV / CardDAV protocol endpoints
  app.use('/dav', createDavRouter());

  // REST API endpoints
  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChronoDAV server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
