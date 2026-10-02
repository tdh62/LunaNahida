import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { copySearchDictionary } from './search-dictionary.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'bin');
mkdirSync(output, { recursive: true });
const executable = join(output, process.platform === 'win32' ? 'LunaNahida.exe' : 'LunaNahida');
const build = spawnSync('go', ['build', '-tags', 'production', ...(process.platform === 'win32' ? ['-ldflags', '-H windowsgui'] : []), '-o', executable, '.'], { cwd: root, stdio: 'inherit', shell: false });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
await copySearchDictionary(output);
console.log(`Desktop package: ${output}`);
