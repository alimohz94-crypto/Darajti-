function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])])
    );
  }
  return value;
}

function sourceValuesMatch(source, destination) {
  return Object.keys(source).every(
    (key) =>
      JSON.stringify(normalizeValue(source[key])) ===
      JSON.stringify(normalizeValue(destination[key]))
  );
}

function conflictKey(row, columns) {
  return JSON.stringify(columns.map((column) => row[column]));
}

export async function insertRowsSafely(
  supabase,
  table,
  rows,
  onConflict = 'id',
  batchSize = 100
) {
  const conflictColumns = onConflict.split(',').map((column) => column.trim()).filter(Boolean);
  if (conflictColumns.length === 0) throw new Error('A conflict key is required.');

  let inserted = 0;
  let unchanged = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const conflictColumn = conflictColumns[0];
    const conflictValues = [...new Set(batch.map((row) => row[conflictColumn]))];
    const { data: existingRows, error: readError } = await supabase
      .from(table)
      .select('*')
      .in(conflictColumn, conflictValues);
    if (readError) throw new Error(`${table}: unable to check destination conflicts: ${readError.message}`);

    const existingByKey = new Map(
      (existingRows || []).map((row) => [conflictKey(row, conflictColumns), row])
    );
    const newRows = [];
    for (const row of batch) {
      const existing = existingByKey.get(conflictKey(row, conflictColumns));
      if (!existing) {
        newRows.push(row);
        continue;
      }
      if (!sourceValuesMatch(row, existing)) {
        throw new Error(
          `${table}: destination conflict on ${conflictColumns.join(', ')}; no rows in this batch were inserted or overwritten.`
        );
      }
      unchanged += 1;
    }

    if (newRows.length > 0) {
      const { error: insertError } = await supabase.from(table).insert(newRows);
      if (insertError) throw new Error(`${table}: insert failed: ${insertError.message}`);
      inserted += newRows.length;
    }
  }

  return { inserted, unchanged };
}
