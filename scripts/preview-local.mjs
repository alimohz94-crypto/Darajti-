import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_PREVIEW_API_BASE = 'http://127.0.0.1:3000';

export function createLocalPreviewEnvironment(environment = process.env) {
  return {
    ...environment,
    VITE_API_BASE_URL: LOCAL_PREVIEW_API_BASE,
  };
}

function runVite(args, environment) {
  const viteCli = path.resolve('node_modules/vite/bin/vite.js');
  const result = spawnSync(process.execPath, [viteCli, ...args], {
    stdio: 'inherit',
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error(`Vite ${args[0]} was terminated by ${result.signal || 'an unknown signal'}.`);
  }
  return result.status;
}

function main() {
  const environment = createLocalPreviewEnvironment();
  const buildStatus = runVite(['build', '--mode', 'local-preview'], environment);
  if (buildStatus !== 0) {
    process.exitCode = buildStatus;
    return;
  }
  process.exitCode = runVite(['preview', '--host', '127.0.0.1'], environment);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
