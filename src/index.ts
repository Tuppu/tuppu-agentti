import dotenv from 'dotenv';
dotenv.config();

import { PORT } from './config.js';
import { initDatabase } from './database.js';
import { indexAll } from './indexer.js';
import { app } from './server.js';

/**
 * Application entry point
 */

// Initialize database
initDatabase();

// Start server
app.listen(PORT, async () => {
  console.log(`Tuppu Agent listening on :${PORT}`);
  await indexAll();
});
