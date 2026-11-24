import Database from 'better-sqlite3';

const db = new Database('./data/darajati.db', { readonly: true });

const tables = db
  .prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
  .all();

for (const table of tables) {
  const quotedName = table.name.replace(/'/g, "''");
  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM '${quotedName}'`)
    .get().count;

  console.log(`\n=== ${table.name} (${count} rows) ===`);
  console.log(table.sql);
  console.log('columns=' + JSON.stringify(db.prepare(`PRAGMA table_info('${quotedName}')`).all()));
  console.log('foreign_keys=' + JSON.stringify(db.prepare(`PRAGMA foreign_key_list('${quotedName}')`).all()));
  console.log('indexes=' + JSON.stringify(db.prepare(`PRAGMA index_list('${quotedName}')`).all()));
}

const demos = db.prepare('SELECT COUNT(*) AS count FROM listings WHERE is_demo = 1').get().count;
console.log(`\n=== transfer ===`);
console.log(`demo_listings=${demos}`);

db.close();
