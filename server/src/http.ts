import express from 'express';
import { join } from 'path';
import { sessions } from './session-manager.js';

export function createApp(webDir: string, pkg: { version: string }, startedAt: Date): express.Express {
  const app = express();

  // Landing page at root
  app.get('/', (_req, res) => {
    res.sendFile(join(webDir, 'landing.html'));
  });

  // Chinese landing page
  app.get('/zh', (_req, res) => {
    res.sendFile(join(webDir, 'landing.zh.html'));
  });

  // Serve index.html with no-store (Vite hashed filenames handle cache-busting)
  const sendIndexHtml = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(webDir, 'index.html'));
  };

  // Intercept /index.html before express.static to ensure no-store is applied
  app.get('/index.html', sendIndexHtml);

  // Serve static assets from web/ — hashed assets are immutable, others use no-cache
  app.use(express.static(webDir, {
    setHeaders(res, filePath) {
      if (filePath.includes('assets')) {
        // Vite-hashed files (e.g. index-CqWVRN_z.js) — immutable
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA fallback: /s/:sessionId → serve versioned index.html
  app.get('/s/:sessionId', sendIndexHtml);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      agents: sessions.agents.size,
      webClients: sessions.webClients.size,
      timestamp: new Date().toISOString(),
    });
  });

  // Server status (aggregate stats, no agent details exposed)
  app.get('/api/status', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      server: {
        version: pkg.version,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
        memoryMB: Math.round(mem.rss / 1024 / 1024),
      },
      agents: {
        connected: sessions.agents.size,
      },
      webClients: {
        connected: sessions.webClients.size,
      },
    });
  });

  // Session info API (web client fetches this to know agent details)
  app.get('/api/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const agent = sessions.getAgentBySession(sessionId);
    if (agent) {
      res.json({
        sessionId,
        agent: {
          name: agent.name,
          workDir: agent.workDir,
          connectedAt: agent.connectedAt,
        },
      });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  return app;
}
