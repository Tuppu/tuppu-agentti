import { htmlToText } from 'html-to-text';

/**
 * Utility functions
 */

/**
 * Strip HTML and convert to plain text
 */
export function strip(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [{ selector: 'a', options: { ignoreHref: true } }],
  }).trim();
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosSim(a: readonly number[] | Float32Array, b: readonly number[] | Float32Array): number {
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

/**
 * Convert Buffer to number array
 */
export function bufToArr(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

/**
 * Convert number array to Buffer
 */
export function arrToBuf(arr: number[]): Buffer {
  return Buffer.from(new Float32Array(arr).buffer);
}

/**
 * Split text into chunks with overlap
 */
export function chunk(text: string, size = 900, overlap = 180): string[] {
  if (!text) return [];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += Math.max(1, size - overlap);
  }
  return out;
}
