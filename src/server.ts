import express from 'express';
import { indexAll } from './indexer.js';
import { answer } from './retrieval.js';

/**
 * HTTP API and browser UI
 */

export const app = express();
app.use(express.json());

// health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// re-index endpoint
app.post('/reindex', async (_req, res) => {
  try {
    await indexAll();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Q&A endpoint
app.post('/ask', async (req, res) => {
  const q = (req.body?.q ?? '').toString().trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  try {
    const a = await answer(q);
    res.json({ answer: a });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// simple UI at root
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Tuppu Agent</title>
<style>
  :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
  body { margin: 24px; }
  h1 { margin: 0 0 12px; }
  .card { max-width: 900px; padding: 16px; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.04); }
  textarea { width: 100%; height: 90px; padding: 12px; font-size: 16px; border-radius: 10px; border: 1px solid #ccc; }
  button { margin-top: 10px; padding: 10px 16px; font-size: 15px; border-radius: 10px; border: 0; background: #0ea5e9; color: white; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  pre { white-space: pre-wrap; word-wrap: break-word; background: #fafafa; padding: 12px; border-radius: 10px; border: 1px solid #eee; }
  .muted { color: #666; font-size: 13px; }
</style>
</head>
<body>
  <h1>Tuppu Agent</h1>
  <div class="card">
    <label for="q"><b>Question</b></label>
    <textarea id="q" placeholder="Ask anything about the blog..."></textarea>
    <button id="ask">Ask</button>
    <div id="out" style="margin-top:14px;"></div>
    <p class="muted">Tip: if answers don't appear, make sure your llama.cpp server is running on port 8080.</p>
  </div>
<script>
  const q = document.getElementById('q');
  const btn = document.getElementById('ask');
  const out = document.getElementById('out');
  btn.onclick = async () => {
    const text = q.value.trim();
    if (!text) return;
    btn.disabled = true;
    out.innerHTML = '<em>Asking…</em>';
    try {
      const r = await fetch('/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || r.statusText);
      out.innerHTML = '<pre>' + (j.answer || '') + '</pre>';
    } catch (e) {
      out.innerHTML = '<pre style="color:#b91c1c">Error: ' + e + '</pre>';
    } finally {
      btn.disabled = false;
    }
  };
</script>
</body>
</html>`);
});
