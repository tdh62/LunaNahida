import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The portable package requires Windows x64.');
}

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'resources', 'WebView2');
for (const name of ['msedgewebview2.exe', join('EBWebView', 'x64', 'EmbeddedBrowserWebView.dll')]) {
  const file = join(source, name);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`Fixed WebView2 runtime is incomplete: ${file}`);
  }
}

const output = join(root, 'bin', 'portable');
const runtime = join(output, 'WebView2');
mkdirSync(output, { recursive: true });
const build = spawnSync('go', ['build', '-tags', 'production,portable', '-o', join(output, 'LunaNahida.exe'), '.'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64' },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(runtime, { recursive: true, force: true });
cpSync(source, runtime, { recursive: true });
console.log(`Portable package: ${output}`);
