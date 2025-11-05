import fetch from 'node-fetch';
import { WP_POSTS, RSSS } from './config.js';
import { strip } from './utils.js';

/**
 * Content fetching from WordPress and RSS feeds
 */

export interface Post {
  url: string;
  title: string;
  content: string;
}

/**
 * Fetch all posts from WordPress REST API and RSS feeds
 */
export async function fetchAllPosts(): Promise<Post[]> {
  const out: Post[] = [];

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

  // RSS fallback if REST returns nothing
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

  // Deduplicate by URL
  const seen = new Set<string>();
  return out.filter((d) => !seen.has(d.url) && seen.add(d.url));
}
