import express from 'express';
import { join } from 'path';
import { readFileSync } from 'fs';
import { sessions } from './session-manager.js';

// Entra ID config — read from environment variables at startup (optional)
const entraClientId = process.env.ENTRA_CLIENT_ID;
const entraTenantId = process.env.ENTRA_TENANT_ID;
const entraConfigured = !!(entraClientId && entraTenantId);

// Base64-encode the config once at startup (empty string if not configured)
const entraConfigB64 = entraConfigured
  ? Buffer.from(JSON.stringify({
      clientId: entraClientId,
      tenantId: entraTenantId,
    })).toString('base64')
  : '';

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

  // Serve index.html with Entra config injected via <meta> tag
  const sendIndexHtmlWithEntra = (_req: express.Request, res: express.Response) => {
    try {
      const html = readFileSync(join(webDir, 'index.html'), 'utf-8');
      const injected = html.replace('<head>', `<head>\n    <meta name="entra-config" content="${entraConfigB64}">`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/html');
      res.send(injected);
    } catch {
      res.status(500).send('Internal server error');
    }
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

  // MSAL SPA callback — serve SPA with Entra config for MSAL.js to handle the auth code
  app.get('/auth/callback', (req, res) => {
    if (!entraConfigured) {
      res.status(500).send('Entra ID not configured.');
      return;
    }
    sendIndexHtmlWithEntra(req, res);
  });

  // SPA fallback: /s/:sessionId → serve versioned index.html (no login)
  // Block /s/ access for Entra-protected sessions — must use /ms/ path
  app.get('/s/:sessionId', (req, res) => {
    const agent = sessions.getAgentBySession(req.params.sessionId);
    if (agent?.entra) {
      res.redirect(302, `/ms/${req.params.sessionId}`);
      return;
    }
    sendIndexHtml(req, res);
  });

  // Protected route: /ms/:sessionId → serve index.html with Entra config (login required)
  app.get('/ms/:sessionId', (req, res) => {
    if (!entraConfigured) {
      res.status(500).send('Entra ID not configured. Set ENTRA_CLIENT_ID and ENTRA_TENANT_ID environment variables.');
      return;
    }
    sendIndexHtmlWithEntra(req, res);
  });

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

  return app;
}
