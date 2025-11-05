/**
 * Application configuration
 */

export const BLOG = 'https://tuppu.fi';
export const WP_POSTS = `${BLOG}/wp-json/wp/v2/posts?_fields=id,link,slug,title,content,excerpt,date,modified&per_page=100&page=`;
export const RSSS = [
  `${BLOG}/feed/`,
  `${BLOG}/category/politiikka/feed/`,
  `${BLOG}/category/talous/feed/`,
  `${BLOG}/category/tiede/feed/`,
  `${BLOG}/category/luonto/feed/`,
];

// Local LLM server (llama.cpp) – OpenAI-compatible.
export const LLM_BASE = process.env.LLM_BASE ?? 'http://127.0.0.1:8080/v1';

export const PORT = Number(process.env.PORT ?? 3000);
