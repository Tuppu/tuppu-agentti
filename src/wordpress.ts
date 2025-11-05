import fetch from 'node-fetch';
import { BLOG, WP_API_BASE, WP_USERNAME, WP_PASSWORD } from './config.js';
import { generateWithLocalLLM } from './models.js';
import { db } from './database.js';
import { cosSim, bufToArr } from './utils.js';
import { embed } from './models.js';

/**
 * WordPress posting and AI article generation
 */

export interface ArticleRequest {
  keywords: string[];
  category?: string;
  tone?: 'informative' | 'conversational' | 'formal' | 'casual';
  length?: 'short' | 'medium' | 'long';
}

export interface GeneratedArticle {
  title: string;
  content: string;
  excerpt: string;
  sources: Array<{ title: string; url: string }>;
}

/**
 * Search for relevant content based on keywords
 */
async function findRelevantContent(keywords: string[], limit = 5) {
  // Create a search query from keywords
  const queryText = keywords.join(' ');
  const queryVec = await embed(queryText);

  const rows = db
    .prepare('SELECT url,title,chunk_index,content,vector FROM docs')
    .all() as any[];

  const lowerKeywords = keywords.map(k => k.toLowerCase());

  const scored = rows.map((r) => {
    const v = bufToArr(r.vector as Buffer);
    let s = cosSim(queryVec, v);
    const title = (r.title ?? '').toLowerCase();
    const body = (r.content ?? '').toLowerCase();
    
    // Boost score if keywords are found
    lowerKeywords.forEach(kw => {
      if (title.includes(kw)) s += 0.1;
      if (body.includes(kw)) s += 0.05;
    });
    
    return { ...r, score: s };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score >= 0.3).slice(0, limit);
}

/**
 * Generate an article using AI based on keywords and existing content
 */
export async function generateArticle(request: ArticleRequest): Promise<GeneratedArticle> {
  const { keywords, category = 'general', tone = 'informative', length = 'medium' } = request;

  if (!keywords || keywords.length === 0) {
    throw new Error('At least one keyword is required');
  }

  // Find relevant content from existing articles
  const relevantDocs = await findRelevantContent(keywords, 5);

  if (relevantDocs.length === 0) {
    throw new Error('No relevant content found in the database. Please index some articles first.');
  }

  // Build context from relevant documents
  const context = relevantDocs
    .slice(0, 3)
    .map((doc, i) => `[Source ${i + 1}] ${doc.title}\n${doc.content.slice(0, 500)}`)
    .join('\n\n');

  // Determine word count based on length
  const wordCounts = {
    short: '400-600',
    medium: '800-1200',
    long: '1500-2000',
  };
  const targetWords = wordCounts[length];

  // Generate title
  const titleSystem = `You are a professional blog title writer for Tuppu.fi. Create engaging, clear, and SEO-friendly titles.`;
  const titlePrompt = `Create a compelling blog post title about: ${keywords.join(', ')}

Category: ${category}
Tone: ${tone}

Generate ONE title only. Make it engaging and relevant. Do not add quotes or extra formatting.`;

  const title = await generateWithLocalLLM(titleSystem, titlePrompt, {
    maxTokens: 100,
    temperature: 0.7,
    timeoutMs: 15000000,
  });

  // Generate main article content
  const contentSystem = `You are a professional content writer for Tuppu.fi, a Finnish blog. Write in clear, engaging English.
Write ${tone} content that is well-structured with paragraphs. Do not use markdown headers or formatting - just plain paragraphs.
Base your article on the provided source material but expand and synthesize the information into a cohesive piece.`;

  const contentPrompt = `Write a ${length} blog post (${targetWords} words) about: ${keywords.join(', ')}

Title: ${title}
Category: ${category}
Tone: ${tone}

Reference Material:
${context}

Write a complete article with:
- An engaging introduction
- Well-developed body paragraphs with specific information
- A thoughtful conclusion
- Natural flow between ideas

Write in plain text paragraphs (no markdown headers). Make it informative and engaging.`;

  const content = await generateWithLocalLLM(contentSystem, contentPrompt, {
    maxTokens: length === 'long' ? 2000 : length === 'medium' ? 1200 : 800,
    temperature: 0.7,
    timeoutMs: 60000000,
  });

  // Generate excerpt
  const excerptSystem = `You are a professional content summarizer. Create compelling excerpts that encourage readers to read more.`;
  const excerptPrompt = `Create a brief 2-3 sentence excerpt (under 160 characters) for this article:

Title: ${title}

Content Preview:
${content.slice(0, 500)}

Write an engaging excerpt that captures the main point.`;

  const excerpt = await generateWithLocalLLM(excerptSystem, excerptPrompt, {
    maxTokens: 100,
    temperature: 0.6,
    timeoutMs: 15000000,
  });

  // Collect sources
  const sources = relevantDocs.slice(0, 3).map(doc => ({
    title: doc.title,
    url: doc.url,
  }));

  return {
    title: title.replace(/^["']|["']$/g, '').trim(),
    content: content.trim(),
    excerpt: excerpt.trim(),
    sources,
  };
}

/**
 * Test WordPress credentials
 */
export async function testWordPressCredentials() {
  if (!WP_USERNAME || !WP_PASSWORD) {
    return { success: false, error: 'WordPress credentials not configured. Set WP_USERNAME and WP_PASSWORD in .env file' };
  }

  const auth = Buffer.from(`${WP_USERNAME}:${WP_PASSWORD}`).toString('base64');

  try {
    const response = await fetch(`${WP_API_BASE}/users/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { success: false, error: `Authentication failed (${response.status}): ${errorText}` };
    }

    const user = await response.json() as any;
    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        capabilities: user.capabilities,
      }
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Post an article to WordPress
 */
export async function postToWordPress(article: GeneratedArticle, status: 'draft' | 'publish' = 'draft') {
  if (!WP_USERNAME || !WP_PASSWORD) {
    throw new Error('WordPress credentials not configured. Set WP_USERNAME and WP_PASSWORD in .env file');
  }

  // Add sources to the end of the content
  const contentWithSources = `${article.content}

<hr>

<p><em>This article was generated with AI assistance based on the following sources:</em></p>
<ul>
${article.sources.map(s => `<li><a href="${s.url}">${s.title}</a></li>`).join('\n')}
</ul>`;

  // Create basic auth header
  const auth = Buffer.from(`${WP_USERNAME}:${WP_PASSWORD}`).toString('base64');

  const response = await fetch(`${WP_API_BASE}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
    },
    body: JSON.stringify({
      title: article.title,
      content: contentWithSources,
      excerpt: article.excerpt,
      status: status,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Failed to post to WordPress (${response.status}): ${errorText}`);
  }

  const result = await response.json() as any;

  return {
    id: result.id,
    url: result.link,
    status: result.status,
    title: result.title?.rendered ?? article.title,
  };
}

/**
 * Generate and post an article in one step
 */
export async function generateAndPost(
  request: ArticleRequest,
  status: 'draft' | 'publish' = 'draft'
) {
  const article = await generateArticle(request);
  const posted = await postToWordPress(article, status);
  
  return {
    article,
    post: posted,
  };
}
