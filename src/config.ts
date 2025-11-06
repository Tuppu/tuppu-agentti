/**
 * Application configuration
 */

export const BLOG = 'https://tuppu.fi';
export const WP_POSTS = `${BLOG}/wp-json/wp/v2/posts?_fields=id,link,slug,title,content,excerpt,date,modified&per_page=100&page=`;
export const WP_CATEGORIES = `${BLOG}/wp-json/wp/v2/categories?per_page=100`;
export const MAIN_RSS = `${BLOG}/feed/`;

// Local LLM server (llama.cpp) – OpenAI-compatible.
export const LLM_BASE = process.env.LLM_BASE ?? 'http://localhost:11434/v1';
export const LLM_MODEL = process.env.LLM_MODEL ?? 'phi3';

export const PORT = Number(process.env.PORT ?? 3000);

// WordPress credentials (set these in .env file)
export const WP_USERNAME = process.env.WP_USERNAME ?? '';
export const WP_PASSWORD = process.env.WP_PASSWORD ?? '';
export const WP_API_BASE = `${BLOG}/wp-json/wp/v2`;
