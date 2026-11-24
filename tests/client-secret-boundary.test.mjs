import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');
const forbiddenPatterns = [
  /@supabase\/supabase-js/,
  /\bSUPABASE_SECRET_KEY\b/,
  /\bSUPABASE_SERVICE_ROLE_KEY\b/,
  /\bVITE_SUPABASE_SECRET_KEY\b/,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(filePath));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(filePath);
  }
  return files;
}

test('React source does not import Supabase or reference server-only keys', async () => {
  const violations = [];
  for (const filePath of await sourceFiles(sourceRoot)) {
    const content = await readFile(filePath, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) violations.push(`${path.relative(sourceRoot, filePath)}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});
