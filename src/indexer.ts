import pLimit from 'p-limit';
import { db } from './database.js';
import { fetchAllPosts } from './fetcher.js';
import { chunk, arrToBuf } from './utils.js';
import { embed } from './models.js';

/**
 * Content indexing (at chunk level)
 */

/**
 * Index all posts from WordPress/RSS into the database
 */
export async function indexAll(): Promise<void> {
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
        console.log('Indexed:', d.title, `(${parts.length} chunk(s))`);
      })
    )
  );
}
