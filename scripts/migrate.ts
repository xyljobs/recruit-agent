import { readFileSync } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ quiet: true });

const connectionString = process.env.PGDATABASE_URL;
if (!connectionString) {
  throw new Error('PGDATABASE_URL is not set; use the direct PostgreSQL URL from the self-hosted Supabase stack');
}

const sql = readFileSync(resolve(process.cwd(), 'scripts', 'migrate.sql'), 'utf8');

async function migrate(): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(sql);
    console.log('Database migration completed successfully.');
  } finally {
    await pool.end();
  }
}

migrate().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
