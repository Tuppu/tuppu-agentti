import { db } from './database.js';
import { cosSim, bufToArr } from './utils.js';
import { embed, generateWithLocalLLM, summarize } from './models.js';

/**
 * Vector search and answer generation
 */

interface SearchResult {
  url: string;
  title: string;
  chunk_index: number;
  content: string;
  vector: Buffer;
  score: number;
}

/**
 * Search for relevant content using vector similarity and keyword matching
 */
function searchVectors(queryVec: number[], question: string, k = 10): SearchResult[] {
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

/**
 * Answer a question using vector search and LLM generation
 */
export async function answer(question: string): Promise<string> {
  const qvec = await embed(question);
  const hits = searchVectors(qvec, question, 10);

  const must = Array.from(new Set(
    question.toLowerCase().split(/\W+/).filter(x => x.length >= 4)
  ));

  const goodHits = hits.filter(h => h.score >= 0.35);
  const strictHits = goodHits.filter(h => must.some(m => h.content.toLowerCase().includes(m)));

  if (!strictHits.length) {
    return `No answer found in Tuppu.fi content.\n\nSources:\n(none)`;
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

  const system = `You are the Tuppu.fi Agent. Answer in clear, concise English using ONLY the provided context.
If the answer cannot be found in the context, reply exactly: "Not found on Tuppu.fi." and include a Sources section. Always include a "Sources:" list of the referenced pages.`;

  const user = `Question: ${question}

Context (only use this information):
${context}

Write a 3–6 sentence answer. If the sources do not cover the topic, state it directly.`;

  // Try LLM; fall back to summarizer if the LLM call fails
  let text: string;
  try {
    text = await generateWithLocalLLM(system, user, { maxTokens: 500, temperature: 0.2, timeoutMs: 25000 });
  } catch {
    const merged = top.map((h) => `**${h.title}**\n${h.content.slice(0, 600)}\n${h.url}`).join('\n\n');
    text = await summarize(merged);
  }

  const links = top.map(h => `- ${h.title} — ${h.url}`).join('\n');
  return `${text}\n\nSources:\n${links}`;
}
