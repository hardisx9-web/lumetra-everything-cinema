import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required; PostgreSQL migration was not run.');
  process.exitCode = 2;
} else {
  const root = resolve(import.meta.dirname, '..');
  const migrationDir = resolve(root, 'db/migrations');
  const client = new Client({ connectionString: databaseUrl, application_name: 'global-cinema-migrate' });
  try {
    await client.connect();
    await client.query('CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const existing = await client.query('SELECT 1 FROM schema_migration WHERE version = $1', [version]);
      if (existing.rowCount) {
        console.log(`skip ${file}`);
        continue;
      }
      const sql = await readFile(resolve(migrationDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migration (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } catch (error) {
    console.error(`PostgreSQL migration failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
