import express from 'express';
import { indexAll } from './indexer.js';
import { answer } from './retrieval.js';
import { generateArticle, postToWordPress, generateAndPost } from './wordpress.js';

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

// Generate article endpoint
app.post('/generate-article', async (req, res) => {
  try {
    const { keywords, category, tone, length } = req.body;
    
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'keywords array is required' });
    }

    const article = await generateArticle({ keywords, category, tone, length });
    res.json({ article });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Post article to WordPress endpoint
app.post('/post-to-wordpress', async (req, res) => {
  try {
    const { article, status = 'draft' } = req.body;
    
    if (!article || !article.title || !article.content) {
      return res.status(400).json({ error: 'article object with title and content is required' });
    }

    const posted = await postToWordPress(article, status);
    res.json({ posted });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Generate and post in one step
app.post('/generate-and-post', async (req, res) => {
  try {
    const { keywords, category, tone, length, status = 'draft' } = req.body;
    
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'keywords array is required' });
    }

    const result = await generateAndPost({ keywords, category, tone, length }, status);
    res.json(result);
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
  h1 { margin: 0 0 8px; }
  h2 { margin: 24px 0 8px; font-size: 20px; }
  .card { max-width: 900px; padding: 16px; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.04); margin-bottom: 20px; }
  textarea { width: 100%; height: 90px; padding: 12px; font-size: 16px; border-radius: 10px; border: 1px solid #ccc; }
  input[type="text"] { width: 100%; padding: 10px; font-size: 15px; border-radius: 8px; border: 1px solid #ccc; }
  select { padding: 10px; font-size: 15px; border-radius: 8px; border: 1px solid #ccc; margin-right: 8px; }
  label { display: block; margin-top: 12px; margin-bottom: 4px; font-weight: 500; }
  button { margin-top: 10px; padding: 10px 16px; font-size: 15px; border-radius: 10px; border: 0; background: #0ea5e9; color: white; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  button.secondary { background: #64748b; }
  button.success { background: #10b981; }
  pre { white-space: pre-wrap; word-wrap: break-word; background: #fafafa; padding: 12px; border-radius: 10px; border: 1px solid #eee; }
  .muted { color: #666; font-size: 13px; }
  .flex { display: flex; gap: 8px; flex-wrap: wrap; }
  .article-preview { background: #f9fafb; padding: 16px; border-radius: 8px; margin-top: 12px; }
  .article-preview h3 { margin: 0 0 12px; color: #1f2937; }
  .article-preview .content { max-height: 300px; overflow-y: auto; margin: 12px 0; }
  .sources { font-size: 13px; color: #6b7280; margin-top: 12px; }
  .sources a { color: #0ea5e9; }
</style>
</head>
<body>
  <h1>Tuppu Agent</h1>
  
  <div class="card">
    <h2>Q&A</h2>
    <label for="q"><b>Question</b></label>
    <textarea id="q" placeholder="Ask anything about the blog..."></textarea>
    <button id="ask">Ask</button>
    <div id="out" style="margin-top:14px;"></div>
    <p class="muted">Tip: if answers don't appear, make sure your llama.cpp server is running on port 8080.</p>
  </div>

  <div class="card">
    <h2>Generate AI Article</h2>
    <label for="keywords"><b>Keywords</b> (comma-separated)</label>
    <input type="text" id="keywords" placeholder="e.g., climate change, renewable energy, sustainability" />
    
    <label for="category"><b>Category</b> (optional)</label>
    <input type="text" id="category" placeholder="e.g., politiikka, talous, tiede" />
    
    <div class="flex" style="margin-top: 12px;">
      <div>
        <label for="tone"><b>Tone</b></label>
        <select id="tone">
          <option value="informative">Informative</option>
          <option value="conversational">Conversational</option>
          <option value="formal">Formal</option>
          <option value="casual">Casual</option>
        </select>
      </div>
      <div>
        <label for="length"><b>Length</b></label>
        <select id="length">
          <option value="short">Short (400-600 words)</option>
          <option value="medium" selected>Medium (800-1200 words)</option>
          <option value="long">Long (1500-2000 words)</option>
        </select>
      </div>
    </div>

    <div class="flex">
      <button id="generate">Generate Article</button>
      <button id="generateAndPost" class="success" style="display:none;">Post to WordPress (Draft)</button>
    </div>
    
    <div id="articleOut"></div>
    <p class="muted">Note: Set WP_USERNAME and WP_PASSWORD in .env to enable WordPress posting.</p>
  </div>

<script>
  // Q&A functionality
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

  // Article generation functionality
  const keywords = document.getElementById('keywords');
  const category = document.getElementById('category');
  const tone = document.getElementById('tone');
  const length = document.getElementById('length');
  const generateBtn = document.getElementById('generate');
  const generateAndPostBtn = document.getElementById('generateAndPost');
  const articleOut = document.getElementById('articleOut');
  
  let currentArticle = null;

  generateBtn.onclick = async () => {
    const kw = keywords.value.trim();
    if (!kw) {
      alert('Please enter at least one keyword');
      return;
    }
    
    const keywordsArray = kw.split(',').map(k => k.trim()).filter(k => k);
    if (keywordsArray.length === 0) {
      alert('Please enter valid keywords');
      return;
    }

    generateBtn.disabled = true;
    articleOut.innerHTML = '<em>Generating article... This may take 30-60 seconds...</em>';
    
    try {
      const r = await fetch('/generate-article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          keywords: keywordsArray,
          category: category.value.trim() || undefined,
          tone: tone.value,
          length: length.value
        })
      });
      
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || r.statusText);
      
      currentArticle = j.article;
      
      const sourcesHtml = currentArticle.sources.map(s => 
        \`<li><a href="\${s.url}" target="_blank">\${s.title}</a></li>\`
      ).join('');
      
      articleOut.innerHTML = \`
        <div class="article-preview">
          <h3>\${currentArticle.title}</h3>
          <p><strong>Excerpt:</strong> \${currentArticle.excerpt}</p>
          <div class="content">
            <p>\${currentArticle.content.replace(/\\n\\n/g, '</p><p>')}</p>
          </div>
          <div class="sources">
            <strong>Sources:</strong>
            <ul>\${sourcesHtml}</ul>
          </div>
        </div>
      \`;
      
      generateAndPostBtn.style.display = 'inline-block';
    } catch (e) {
      articleOut.innerHTML = '<pre style="color:#b91c1c">Error: ' + e + '</pre>';
      generateAndPostBtn.style.display = 'none';
    } finally {
      generateBtn.disabled = false;
    }
  };

  generateAndPostBtn.onclick = async () => {
    if (!currentArticle) return;
    
    if (!confirm('Post this article to WordPress as a draft?')) return;
    
    generateAndPostBtn.disabled = true;
    const originalText = generateAndPostBtn.textContent;
    generateAndPostBtn.textContent = 'Posting...';
    
    try {
      const r = await fetch('/post-to-wordpress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          article: currentArticle,
          status: 'draft'
        })
      });
      
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || r.statusText);
      
      alert(\`Successfully posted to WordPress!\\n\\nURL: \${j.posted.url}\\nStatus: \${j.posted.status}\`);
      generateAndPostBtn.textContent = '✓ Posted!';
      setTimeout(() => {
        generateAndPostBtn.textContent = originalText;
        generateAndPostBtn.disabled = false;
      }, 3000);
    } catch (e) {
      alert('Error posting to WordPress: ' + e);
      generateAndPostBtn.textContent = originalText;
      generateAndPostBtn.disabled = false;
    }
  };
</script>
</body>
</html>`);
});
