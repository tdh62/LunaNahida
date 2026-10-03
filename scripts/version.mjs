import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const projectRoot = resolve(import.meta.dirname, '..');
export const version = readFileSync(join(projectRoot, 'internal/buildinfo/VERSION'), 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(version) || version.split('.').some(value => Number(value) > 65535)) throw new Error('VERSION must contain three numbers from 0 to 65535.');

export function binOutput(directory) {
  const output = resolve(directory);
  const bin = join(projectRoot, 'bin');
  if (output !== bin && !output.startsWith(bin + sep)) throw new Error('Build output must stay inside the project bin directory.');
  return output;
}

export function synchronizeVersion(checkOnly = false) {
  const packagePath = join(projectRoot, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const infoPath = join(projectRoot, 'build/windows/info.json');
  const info = JSON.parse(readFileSync(infoPath, 'utf8'));
  const manifestPath = join(projectRoot, 'build/windows/app.manifest');
  const manifest = readFileSync(manifestPath, 'utf8');
  const nextManifest = manifest.replace(/(<assemblyIdentity\b[^>]*\bversion=")[^"]+/, `$1${version}.0`);
  const expectedInfo = structuredClone(info);
  expectedInfo.fixed.file_version = `${version}.0`;
  expectedInfo.fixed.product_version = `${version}.0`;
  for (const language of ['0000', '0409', '0804']) {
    expectedInfo.info[language] = { ...(expectedInfo.info[language] || expectedInfo.info['0000']), ProductVersion: version, FileVersion: `${version}.0` };
  }
  const changed = pkg.version !== version || JSON.stringify(info) !== JSON.stringify(expectedInfo) || manifest !== nextManifest;
  if (checkOnly && changed) throw new Error('Version fields are out of sync. Run build:version after updating internal/buildinfo/VERSION.');
  if (!checkOnly && changed) {
    pkg.version = version;
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    writeFileSync(infoPath, JSON.stringify(expectedInfo, null, 2) + '\n');
    writeFileSync(manifestPath, nextManifest);
  }
  return version;
}

export function prepareWindowsResources() {
  synchronizeVersion();
  if (process.platform !== 'win32') return;
  const resources = join(projectRoot, 'bin/build-resources');
  mkdirSync(resources, { recursive: true });
  const icon = join(resources, 'icon.ico');
  if (!existsSync(icon) || statSync(icon).mtimeMs < statSync(join(projectRoot, 'build/appicon.png')).mtimeMs) {
    const icons = spawnSync('wails3', ['generate', 'icons', '-input', join(projectRoot, 'build/appicon.png'), '-windowsfilename', icon, '-macfilename', join(resources, 'icon.icns')], { cwd: projectRoot, stdio: 'inherit', shell: false });
    if (icons.error || icons.status !== 0) throw new Error('Cannot generate application icons. Install the matching Wails v3 CLI and retry.');
  }
  const infoPath = join(projectRoot, 'build/windows/info.json');
  const target = join(projectRoot, 'windows_amd64.syso');
  const manifestPath = join(projectRoot, 'build/windows/app.manifest');
  const result = spawnSync('wails3', ['generate', 'syso', '-arch', 'amd64', '-icon', icon, '-info', infoPath, '-manifest', manifestPath, '-out', target], { cwd: projectRoot, stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error('Cannot generate Windows version resources. Install the matching Wails v3 CLI and retry.');
}

export function verifyWindowsVersion(executable) {
  if (process.platform !== 'win32') return;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$info = (Get-Item -LiteralPath $env:LUNANAHIDA_BUILD_EXE).VersionInfo; if ($info.ProductVersion -ne $env:LUNANAHIDA_RELEASE_VERSION -or $info.FileVersion -ne ($env:LUNANAHIDA_RELEASE_VERSION + ".0")) { throw "Executable version resource mismatch" }'], { cwd: projectRoot, encoding: 'utf8', shell: false, env: { ...process.env, LUNANAHIDA_BUILD_EXE: executable, LUNANAHIDA_RELEASE_VERSION: version } });
  if (result.error || result.status !== 0) throw new Error(result.stderr || 'Cannot verify Windows executable version resources.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Version: ${synchronizeVersion(process.argv.includes('--check'))}`);
}
