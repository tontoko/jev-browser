import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Explicit files avoid platform-specific shell glob expansion on Windows/Node 22.
const files = readdirSync(new URL('../test/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=60000', ...process.argv.slice(2), ...files], { stdio: 'inherit', cwd: new URL('..', import.meta.url), env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
