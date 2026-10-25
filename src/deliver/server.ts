import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { dbService } from '../db/index.js';
import { debtEngine } from '../engine/debt.js';

export function createWebServer(): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // API: Dismiss reply debt
    if (req.method === 'POST' && url.pathname === '/api/dismiss') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body || '{}');
          if (!id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id' }));
            return;
          }
          const success = dbService.dismissReplyDebt(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success, id }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
      return;
    }

    // API: Latest digest JSON
    if (req.method === 'GET' && url.pathname === '/api/digest/latest') {
      const recent = dbService.getRecentDigests(1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recent[0] || null));
      return;
    }

    // HTML Dashboard
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/digest/'))) {
      const recentDigests = dbService.getRecentDigests(10);
      const activeDebts = dbService.getOpenReplyDebt();
      const formattedDebts = debtEngine.formatActiveDebtForDigest(activeDebts);

      // Check if viewing a specific date
      const dateParam = url.pathname.replace('/digest/', '');
      const selectedDigest = dateParam && dateParam !== '/'
        ? recentDigests.find((d) => d.digest_date === dateParam) || recentDigests[0]
        : recentDigests[0];

      // Read markdown file if present
      let rawMarkdown = selectedDigest?.summary_markdown || '';
      if (!rawMarkdown) {
        const latestFile = path.join(config.storage.digestDir, 'latest.md');
        if (fs.existsSync(latestFile)) {
          rawMarkdown = fs.readFileSync(latestFile, 'utf-8');
        }
      }

      const html = renderDashboardHtml({
        selectedDigest,
        recentDigests,
        activeDebts: formattedDebts,
        markdown: rawMarkdown,
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return server;
}

function renderDashboardHtml(data: {
  selectedDigest?: any;
  recentDigests: any[];
  activeDebts: any[];
  markdown: string;
}): string {
  const d = data.selectedDigest;
  const timeSaved = d ? `${Math.floor(d.read_time_saved_minutes / 60)}h ${Math.round(d.read_time_saved_minutes % 60)}m` : '0 min';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🦥 Sloth Digest — Overnight AI Executive Briefing</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.15);
      --success: #4ade80;
      --warning: #fbbf24;
      --danger: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    .brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand h1 { font-size: 1.75rem; font-weight: 700; }
    .brand span { font-size: 2.2rem; }
    .badge-privacy {
      background: rgba(74, 222, 128, 0.1);
      color: var(--success);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      border: 1px solid rgba(74, 222, 128, 0.25);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      text-align: center;
    }
    .stat-val { font-size: 2rem; font-weight: 800; color: var(--accent); }
    .stat-lbl { font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; margin-top: 0.25rem; }

    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .debt-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .debt-badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 700;
      background: rgba(251, 191, 36, 0.15);
      color: var(--warning);
      margin-bottom: 0.25rem;
    }
    .debt-subj { font-weight: 600; font-size: 1rem; }
    .debt-ask { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.25rem; }
    .btn-dismiss {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .btn-dismiss:hover {
      background: var(--danger);
      color: white;
      border-color: var(--danger);
    }
    .markdown-view {
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9rem;
      line-height: 1.6;
      background: rgba(15, 23, 42, 0.5);
      padding: 1.5rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      color: #e2e8f0;
    }
    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 3rem;
      border-top: 1px solid var(--border);
      padding-top: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <span>🦥</span>
        <div>
          <h1>Sloth Digest</h1>
          <div style="font-size: 0.85rem; color: var(--text-muted);">
            Overnight Executive Briefing • ${d?.digest_date || new Date().toISOString().slice(0, 10)}
          </div>
        </div>
      </div>
      <div class="badge-privacy">🔒 Zero-Cloud AI • Local Only</div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val">${d?.emails_processed ?? 0}</div>
        <div class="stat-lbl">Emails Ingested</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${d?.threads_summarized ?? 0}</div>
        <div class="stat-lbl">Threads Digested</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--warning);">${data.activeDebts.length}</div>
        <div class="stat-lbl">Action Items</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color: var(--success);">${timeSaved}</div>
        <div class="stat-lbl">Reading Time Saved</div>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">🎯 Things You Need To Reply To</div>
      ${data.activeDebts.length === 0
        ? '<div style="color: var(--success); padding: 0.5rem 0;">🎉 No pending reply debt! Your inbox is up to date.</div>'
        : data.activeDebts.map((item) => `
          <div class="debt-item" id="debt-${item.id}">
            <div>
              <span class="debt-badge">${item.badge}</span>
              <div class="debt-subj">${item.subject} <span style="font-size: 0.85rem; color: var(--text-muted); font-weight: normal;">from ${item.from}</span></div>
              <div class="debt-ask">💡 ${item.ask}</div>
            </div>
            <button class="btn-dismiss" onclick="dismissDebt('${item.id}')">Dismiss ✓</button>
          </div>
        `).join('')}
    </div>

    <div class="section-card">
      <div class="section-title">📄 Full Overnight Briefing</div>
      <div class="markdown-view">${escapeHtml(data.markdown)}</div>
    </div>

    <footer>
      Powered by <strong>Gemma 4B</strong> on <strong>llama.cpp</strong>, <strong>Mastra</strong>, and <strong>Temporal</strong>.<br>
      Built for Hacktoberfest 2026 Week 3: "Slow and Steady"
    </footer>
  </div>

  <script>
    async function dismissDebt(id) {
      try {
        const res = await fetch('/api/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        if (res.ok) {
          const el = document.getElementById('debt-' + id);
          if (el) {
            el.style.opacity = '0.3';
            el.style.pointerEvents = 'none';
          }
        }
      } catch (err) {
        alert('Could not dismiss item: ' + err.message);
      }
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const server = createWebServer();
  const port = config.storage.webPort;
  server.listen(port, () => {
    console.log(`[web] Sloth Digest dashboard running at http://localhost:${port}/`);
  });
}
