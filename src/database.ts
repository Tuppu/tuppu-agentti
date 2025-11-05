import Database from 'better-sqlite3';

/**
 * Database setup and migration
 */

export const db = new Database('tuppu.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

function tableExists(name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as any;
  return !!row;
}

function tableHasColumn(table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some(r => r.name === col);
}

/**
 * Initialize and migrate database schema
 */
export function initDatabase() {
  // 1) If the table doesn't exist, create the latest schema
  if (!tableExists('docs')) {
    db.exec(`
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT,
        vector BLOB
      );
    `);
  }

  // 2) If there is an old schema (without chunk_index), migrate
  if (!tableHasColumn('docs', 'chunk_index')) {
    db.exec(`ALTER TABLE docs RENAME TO docs_old;`);
    db.exec(`
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT,
        vector BLOB
      );
    `);
    const oldRows = db.prepare(`SELECT url, title, content, vector FROM docs_old`).all() as any[];
    const ins = db.prepare(`INSERT INTO docs (url,title,chunk_index,content,vector) VALUES (?,?,?,?,?)`);
    const tx = db.transaction(() => {
      for (const r of oldRows) ins.run(r.url, r.title, 0, r.content, r.vector);
    });
    tx();
    db.exec(`DROP TABLE docs_old;`);
  }

  // 3) Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_docs_url ON docs(url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_url_chunk ON docs(url, chunk_index);
  `);
}
