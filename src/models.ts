import { pipeline } from '@xenova/transformers';
import fetch from 'node-fetch';
import { LLM_BASE } from './config.js';

/**
 * Local models (Xenova) and LLM integration
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

/**
 * Generate embeddings for text
 */
export async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text.slice(0, 8000), { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Summarize text using local model
 */
export async function summarize(text: string): Promise<string> {
  const summarizer = await getSummarizer();
  const result = await summarizer(text.slice(0, 3000), { max_length: 200, min_length: 60 });
  return (result[0].summary_text ?? '').toString();
}

/**
 * Type for chat completion response
 */
type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string } | null;
    // some servers return 'text' for compatibility
    text?: string;
  }>;
};

/**
 * Generate text using local LLM (llama.cpp)
 */
export async function generateWithLocalLLM(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
): Promise<string> {
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

    const j = (await r.json()) as ChatCompletionResponse;

    // permissive extraction (llama.cpp builds may return 'text')
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
