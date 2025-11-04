import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';
import { htmlToText } from 'html-to-text';
import pLimit from 'p-limit';
import { pipeline } from '@xenova/transformers';

/**
 * -----------------------------------------
 *  Perusasetukset
 * -----------------------------------------
 */
const BLOG = 'https://tuppu.fi';
const WP_POSTS = `${BLOG}/wp-json/wp/v2/posts?_fields=id,link,slug,title,content,excerpt,date,modified&per_page=100&page=`;
const RSSS = [
  `${BLOG}/feed/`,
  `${BLOG}/category/politiikka/feed/`,
  `${BLOG}/category/talous/feed/`,
  `${BLOG}/category/tiede/feed/`,
  `${BLOG}/category/luonto/feed/`,
];

// Paikallisen LLM-palvelimen (llama.cpp) osoite – OpenAI-yhteensopiva.
const LLM_BASE = process.env.LLM_BASE ?? 'http://127.0.0.1:8080/v1';

/**
 * -----------------------------------------
 *  Tietokanta ja migraatio
 * -----------------------------------------
 */
const db = new Database('tuppu.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

function tableExists(name: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name) as any;
  return !!row;
}
function tableHasColumn(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some(r => r.name === col);
}

// 1) Jos taulua ei ole, luodaan uusin skeema
if (!tableExists('docs')) {
  db.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      chunk_index INTEGER NOT NULL,
      content TEXT,
      vector BLOB
    );
  `);
}

// 2) Jos vanha skeema (ilman chunk_index), migroidaan
if (!tableHasColumn('docs', 'chunk_index')) {
  db.exec(`ALTER TABLE docs RENAME TO docs_old;`);
  db.exec(`
    CREATE TABLE docs (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      chunk_index INTEGER NOT NULL,
      content TEXT,
      vector BLOB
    );
  `);
  const oldRows = db.prepare(`SELECT url, title, content, vector FROM docs_old`).all() as any[];
  const ins = db.prepare(`INSERT INTO docs (url,title,chunk_index,content,vector) VALUES (?,?,?,?,?)`);
  const tx = db.transaction(() => {
    for (const r of oldRows) ins.run(r.url, r.title, 0, r.content, r.vector);
  });
  tx();
  db.exec(`DROP TABLE docs_old;`);
}

// 3) Indeksit
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_docs_url ON docs(url);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_url_chunk ON docs(url, chunk_index);
`);

/**
 * -----------------------------------------
 *  Apurit
 * -----------------------------------------
 */
function strip(html: string) {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [{ selector: 'a', options: { ignoreHref: true } }],
  }).trim();
}

function cosSim(a: readonly number[] | Float32Array, b: readonly number[] | Float32Array) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}
function bufToArr(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}
function arrToBuf(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer);
}
function chunk(text: string, size = 900, overlap = 180): string[] {
  if (!text) return [];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += Math.max(1, size - overlap);
  }
  return out;
}

/**
 * -----------------------------------------
 *  Paikalliset mallit (Xenova)
 * -----------------------------------------
 */
let embedderPromise: Promise<any> | null = null;
async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedderPromise;
}
let summarizerPromise: Promise<any> | null = null;
async function getSummarizer() {
  if (!summarizerPromise) {
    summarizerPromise = pipeline('summarization', 'Xenova/distilbart-cnn-12-6');
  }
  return summarizerPromise;
}
async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text.slice(0, 8000), { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}
async function summarize(text: string) {
  const summarizer = await getSummarizer();
  const result = await summarizer(text.slice(0, 3000), { max_length: 200, min_length: 60 });
  return (result[0].summary_text ?? '').toString();
}

/**
 * -----------------------------------------
 *  Paikallinen LLM generaattori (llama.cpp /chat/completions)
 * -----------------------------------------
 */
// lisää tämän funktion yläpuolelle pikkutyyppi
type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string } | null;
    // jotkin serverit palauttavat myös 'text'
    text?: string;
  }>;
};

async function generateWithLocalLLM(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
) {
  const maxTokens = opts?.maxTokens ?? 600;
  const temperature = opts?.temperature ?? 0.2;
  const timeoutMs = opts?.timeoutMs ?? 25_000;

  const body = {
    model: 'local-llm',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-local',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal as any,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`LLM HTTP ${r.status}: ${txt}`);
    }

    // 🔧 TYYPITETTY JSON
    const j = (await r.json()) as ChatCompletionResponse;

    // suvaitsevainen purku (llama.cpp saattaa palauttaa 'text' joissakin buildeissa)
    const choice = j.choices?.[0];
    const fromMessage = choice?.message?.content?.trim();
    const fromText = (choice as any)?.text?.trim?.(); // fallback
    const text = (fromMessage || fromText || '').toString();

    if (!text) throw new Error('LLM returned empty text');
    return text;
  } finally {
    clearTimeout(t);
  }
}


/**
 * -----------------------------------------
 *  WP/RSS – sisällön haku
 * -----------------------------------------
 */
async function fetchAllPosts(): Promise<Array<{ url: string; title: string; content: string }>> {
  const out: Array<{ url: string; title: string; content: string }> = [];
  // WordPress REST
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(WP_POSTS + page);
    if (!r.ok) break;
    const items = (await r.json()) as any[];
    if (!items.length) break;
    for (const it of items) {
      out.push({
        url: it.link,
        title: (it.title?.rendered ?? '').toString(),
        content: strip(it.content?.rendered ?? it.excerpt?.rendered ?? ''),
      });
    }
  }
  // RSS fallback
  if (out.length === 0) {
    const xmls = await Promise.allSettled(RSSS.map((u) => fetch(u).then((r) => r.text())));
    for (const r of xmls) {
      if (r.status !== 'fulfilled') continue;
      const xml = r.value;
      const items = Array.from(xml.matchAll(/<item>[\s\S]*?<\/item>/g));
      for (const m of items) {
        const raw = m[0];
        const link = /<link>(.*?)<\/link>/s.exec(raw)?.[1]?.trim();
        const title = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/s.exec(raw);
        const desc =
          /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>|<description>([\s\S]*?)<\/description>/s.exec(
            raw
          );
        if (!link) continue;
        out.push({
          url: link,
          title: (title?.[1] ?? title?.[2] ?? '').toString(),
          content: strip((desc?.[1] ?? desc?.[2] ?? '').toString()),
        });
      }
    }
  }
  // deduplikoi urlin mukaan
  const seen = new Set<string>();
  return out.filter((d) => !seen.has(d.url) && seen.add(d.url));
}

/**
 * -----------------------------------------
 *  Indeksointi (chunk-tasolla)
 * -----------------------------------------
 */
async function indexAll() {
  const docs = await fetchAllPosts();
  const limit = pLimit(3);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO docs(url,title,chunk_index,content,vector) VALUES (?,?,?,?,?)'
  );

  await Promise.all(
    docs.map((d) =>
      limit(async () => {
        const parts = chunk(d.content);
        if (parts.length === 0) return;
        for (let i = 0; i < parts.length; i++) {
          const exists = db
            .prepare('SELECT 1 FROM docs WHERE url=? AND chunk_index=?')
            .get(d.url, i);
          if (exists) continue;
          const vec = await embed(`${d.title}\n\n${parts[i]}`);
          ins.run(d.url, d.title, i, parts[i], arrToBuf(vec));
        }
        console.log('Indeksoitu:', d.title, `(${parts.length} osaa)`);
      })
    )
  );
}

/**
 * -----------------------------------------
 *  Haku ja vastaus
 * -----------------------------------------
 */
function searchVectors(queryVec: number[], question: string, k = 10) {
  const rows = db
    .prepare('SELECT url,title,chunk_index,content,vector FROM docs')
    .all() as any[];

  const lowerQ = question.toLowerCase();
  const keywords = Array.from(new Set(lowerQ.split(/\W+/).filter((x) => x.length >= 4)));

  const scored = rows.map((r) => {
    const v = bufToArr(r.vector as Buffer);
    let s = cosSim(queryVec, v);
    const title = (r.title ?? '').toLowerCase();
    const body = (r.content ?? '').toLowerCase();
    if (keywords.some((kw) => title.includes(kw))) s += 0.06;
    if (keywords.some((kw) => body.includes(kw))) s += 0.03;
    return { ...r, score: s };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score >= 0.28).slice(0, k);
}

async function answer(question: string) {
  const qvec = await embed(question);
  const hits = searchVectors(qvec, question, 10);

  const must = Array.from(new Set(
    question.toLowerCase().split(/\W+/).filter(x => x.length >= 4)
  ));

  const goodHits = hits.filter(h => h.score >= 0.35);
  const strictHits = goodHits.filter(h => must.some(m => h.content.toLowerCase().includes(m)));

  if (!strictHits.length) {
    return `En löytänyt Tuppu.fi-sisällöstä vastausta aiheeseen.\n\nLähteet:\n(tyhjää)`;
  }

  const top = strictHits.slice(0, 3);
  const context = top.map((h, i) => {
    const m = must.find(w => h.content.toLowerCase().includes(w));
    const idx = m ? h.content.toLowerCase().indexOf(m) : -1;
    const start = Math.max(0, idx - 220);
    const end = Math.min(h.content.length, idx > -1 ? idx + 400 : 400);
    const excerpt = h.content.slice(start, end).replace(/\s+/g, ' ').trim();
    return `[${i+1}] ${h.title}\n${h.url}\n---\n${excerpt}`;
  }).join('\n\n');

  const system = `Olet Tuppu.fi-agentti. Vastaa suomeksi selkeästi ja tiiviisti käyttäen VAIN annettua kontekstia.
Jos vastausta ei löydy kontekstista, sano: "Ei löydy Tuppu.fi:stä." ja kerro säästä. Jos ei muuta tietoa, kerro että sää on [säätila].
Lisää lopuksi "Lähteet:"-osioon viitelista.`;

  const user = `Kysymys: ${question}

Konteksti (vain tästä saa tietoa):
${context}

Kirjoita 3–6 lauseen vastaus. Jos lähteissä ei ole tietoa aiheesta, ilmoita suoraan ettei löydy.`;

  // Generoi vastaus LLM:llä, fallback summarizeriin
  let text: string;
  try {
    text = await generateWithLocalLLM(system, user, { maxTokens: 500, temperature: 0.2, timeoutMs: 25000 });
  } catch {
    const merged = top.map((h) => `**${h.title}**\n${h.content.slice(0, 600)}\n${h.url}`).join('\n\n');
    text = await summarize(merged);
  }

  const links = top.map(h => `- ${h.title} — ${h.url}`).join('\n');
  return `${text}\n\nLähteet:\n${links}`;
}

/**
 * -----------------------------------------
 *  HTTP API + selain-UI
 * -----------------------------------------
 */
const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/reindex', async (_req, res) => {
  try {
    await indexAll();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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


// Pieni HTML-käyttöliittymä
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Tuppu-agentti</title>
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
  <h1>Tuppu-agentti</h1>
  <div class="card">
    <label for="q"><b>Kysymys</b></label>
    <textarea id="q" placeholder="Mitä blogi kertoo..."></textarea>
    <button id="ask">Kysy</button>
    <div id="out" style="margin-top:14px;"></div>
    <p class="muted">Vinkki: jos vastauksia ei tule, varmista että llama.cpp serveri on käynnissä portissa 8080.</p>
  </div>
<script>
  const q = document.getElementById('q');
  const btn = document.getElementById('ask');
  const out = document.getElementById('out');
  btn.onclick = async () => {
    const text = q.value.trim();
    if (!text) return;
    btn.disabled = true;
    out.innerHTML = '<em>Kysytään…</em>';
    try {
      const r = await fetch('/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || r.statusText);
      out.innerHTML = '<pre>' + (j.answer || '') + '</pre>';
    } catch (e) {
      out.innerHTML = '<pre style="color:#b91c1c">Virhe: ' + e + '</pre>';
    } finally {
      btn.disabled = false;
    }
  };
</script>
</body>
</html>`);
});

/**
 * -----------------------------------------
 *  Käynnistys
 * -----------------------------------------
 */
const PORT = Number(process.env.PORT ?? 3000);
// Pieni HTML-käyttöliittymä juureen
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="fi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Tuppu-agentti</title>
<style>
  :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
  body { margin: 24px; max-width: 900px; }
  textarea { width: 100%; height: 100px; padding: 10px; border-radius: 10px; border:1px solid #ccc; }
  button { margin-top: 10px; padding: 10px 16px; border: 0; border-radius: 10px; background:#0ea5e9; color:#fff; }
  pre { white-space: pre-wrap; background:#fafafa; border:1px solid #eee; padding:12px; border-radius:10px; }
</style></head>
<body>
  <h1>Tuppu-agentti</h1>
  <textarea id="q" placeholder="Kysy blogilta..."></textarea>
  <button id="ask">Kysy</button>
  <div id="out" style="margin-top:14px;"></div>
<script>
  const btn=document.getElementById('ask'), q=document.getElementById('q'), out=document.getElementById('out');
  btn.onclick=async ()=>{
    const text=q.value.trim(); if(!text) return;
    btn.disabled=true; out.innerHTML='<em>Kysytään…</em>';
    try{
      const r=await fetch('/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:text})});
      const j=await r.json(); if(!r.ok) throw new Error(j?.error||r.statusText);
      out.innerHTML='<pre>'+ (j.answer||'') +'</pre>';
    }catch(e){ out.innerHTML='<pre style="color:#b91c1c">Virhe: '+e+'</pre>'; }
    finally{ btn.disabled=false; }
  };
</script>
</body></html>`);
});

app.listen(PORT, async () => {
  console.log(`Tuppu-agentti kuuntelee :${PORT}`);
  await indexAll();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/reindex', async (_req, res) => {
    try {
        await indexAll();
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
