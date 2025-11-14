import fetch from 'node-fetch';
import { WP_POSTS, WP_CATEGORIES, MAIN_RSS, UNCATEGORIZED_FEED, BLOG } from './config.js';
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
 * Fetch all category RSS feed URLs dynamically from WordPress API
 */
async function fetchRSSFeeds(): Promise<string[]> {
  const feeds: string[] = [MAIN_RSS]; // Always include main feed
  
  try {
    console.log('Fetching categories from WordPress API...');
    const response = await fetch(WP_CATEGORIES);
    if (!response.ok) {
      console.warn('Failed to fetch categories, using only main feed');
      // Always try to include uncategorized feed as fallback
      feeds.push(UNCATEGORIZED_FEED);
      return feeds;
    }
    
    const categories = (await response.json()) as any[];
    console.log(`Found ${categories.length} categories`);
    
    // Track if we found an uncategorized category
    let hasUncategorized = false;
    
    for (const cat of categories) {
      if (cat.slug && cat.count > 0) { // Only include categories with posts
        feeds.push(`${BLOG}/category/${cat.slug}/feed/`);
        if (cat.slug === 'uncategorized') {
          hasUncategorized = true;
        }
      }
    }
    
    // Explicitly add uncategorized feed if it wasn't in the categories list
    // or if it had 0 count (but might still have posts)
    if (!hasUncategorized) {
      console.log('Adding uncategorized feed explicitly');
      feeds.push(UNCATEGORIZED_FEED);
    }
    
    console.log(`Generated ${feeds.length} RSS feed URLs`);
    return feeds;
  } catch (error) {
    console.error('Error fetching categories:', error);
    // Always try to include uncategorized feed as fallback
    feeds.push(UNCATEGORIZED_FEED);
    return feeds; // Return at least the main feed
  }
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
    const rssFeeds = await fetchRSSFeeds();
    const xmls = await Promise.allSettled(rssFeeds.map((u: string) => fetch(u).then((r) => r.text())));
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
