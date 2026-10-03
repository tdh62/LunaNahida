import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { copySearchDictionary } from './search-dictionary.mjs';
import { buildConverter, moduleRelativePath } from './build-converter.mjs';
import { binOutput, prepareWindowsResources, verifyWindowsVersion } from './version.mjs';

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

const outputArgument = process.argv.indexOf('--output-dir');
const output = binOutput(outputArgument >= 0 ? process.argv[outputArgument + 1] : join(root, 'bin', 'portable'));
prepareWindowsResources();
const runtime = join(output, 'WebView2');
mkdirSync(output, { recursive: true });
const build = spawnSync('go', ['build', '-tags', 'production,portable', '-ldflags', '-H windowsgui', '-o', join(output, 'LunaNahida.exe'), '.'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64' },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
verifyWindowsVersion(join(output, 'LunaNahida.exe'));

rmSync(runtime, { recursive: true, force: true });
cpSync(source, runtime, { recursive: true });
await copySearchDictionary(output);
if (process.argv.includes('--with-converter')) buildConverter(output);
else rmSync(join(output, moduleRelativePath), { recursive: true, force: true });
console.log(`Portable package: ${output}`);
