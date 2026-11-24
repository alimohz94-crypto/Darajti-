import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { SQLITE_TO_SUPABASE_TABLES } from './migration-plan.mjs';
import { readMigrationSupabaseConfig } from './migration-supabase-config.mjs';
import { insertRowsSafely } from './migration-insert-safe.mjs';

dotenv.config();

const execute = process.argv.includes('--execute');
const confirmedBackup = process.argv.includes('--backup-confirmed');
const sqlitePath = path.resolve(process.env.DATABASE_PATH || './data/darajati.db');

if (!execute) {
  console.log('Dry run: no Supabase data will be changed.');
  console.log('Demo listings are excluded by is_demo = 1.');
  process.exit(0);
}

if (!confirmedBackup) {
  throw new Error('Execution refused: pass --backup-confirmed only after verifying a backup.');
}

const { url: supabaseUrl, secretKey: serviceRoleKey } = readMigrationSupabaseConfig();

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.resolve(`./backups/sqlite-${stamp}`);
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const backupPath = path.join(backupDir, path.basename(sqlitePath));
const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });

try {
  await db.backup(backupPath);

  const backupDb = new Database(backupPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const integrityResults = backupDb.pragma('integrity_check');
    if (
      integrityResults.length !== 1 ||
      integrityResults[0].integrity_check !== 'ok'
    ) {
      throw new Error(
        `SQLite backup integrity check failed: ${JSON.stringify(integrityResults)}`
      );
    }

    const foreignKeyErrors = backupDb.pragma('foreign_key_check');
    if (foreignKeyErrors.length > 0) {
      throw new Error(
        `SQLite backup has foreign-key violations: ${JSON.stringify(foreignKeyErrors)}`
      );
    }

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all();
    for (const { name } of tables) {
      const quotedName = `"${name.replace(/"/g, '""')}"`;
      const sourceCount = db
        .prepare(`SELECT COUNT(*) AS count FROM ${quotedName}`)
        .get().count;
      const backupCount = backupDb
        .prepare(`SELECT COUNT(*) AS count FROM ${quotedName}`)
        .get().count;
      if (sourceCount !== backupCount) {
        throw new Error(
          `SQLite backup row count mismatch in ${name}: source=${sourceCount}, backup=${backupCount}`
        );
      }
    }
  } finally {
    backupDb.close();
  }
} catch (error) {
  db.close();
  throw error;
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const readRows = (table, where = '') =>
  db.prepare(`SELECT * FROM ${table}${where}`).all();

const jsonFields = new Set([
  'images_json',
  'disambiguation_options_json',
]);

const normalizeRows = (rows) =>
  rows.map((row) => {
    const normalized = { ...row };
    for (const field of jsonFields) {
      if (field in normalized && typeof normalized[field] === 'string') {
        try {
          normalized[field] = JSON.parse(normalized[field]);
        } catch {
          normalized[field] = [];
        }
      }
    }
    return normalized;
  });

const insertTable = async (table, rows, onConflict = 'id') => {
  if (!rows.length) {
    console.log(`${table}: 0 rows`);
    return;
  }

  const result = await insertRowsSafely(supabase, table, normalizeRows(rows), onConflict);
  console.log(`${table}: ${result.inserted} inserted, ${result.unchanged} unchanged`);
};

try {
  for (const { table, where = '', onConflict = 'id' } of SQLITE_TO_SUPABASE_TABLES) {
    await insertTable(table, readRows(table, where), onConflict);
  }

  const { error: sequenceError } = await supabase.rpc(
    'sync_darajati_id_sequences'
  );
  if (sequenceError) {
    throw new Error(
      `Failed to synchronize Supabase ID sequences: ${sequenceError.message}`
    );
  }

  console.log(`Verified SQLite backup: ${backupPath}`);
  console.log('Transfer complete. SQLite was not modified or deleted.');
} finally {
  db.close();
}
