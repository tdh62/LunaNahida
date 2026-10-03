import { spawnSync } from 'node:child_process';
import { mkdirSync, cpSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { version, prepareWindowsResources, verifyWindowsVersion } from './version.mjs';

const root = resolve(import.meta.dirname, '..');
export const moduleRelativePath = join('modules', 'music-restore');

export function buildConverter(packageDirectory = join(root, 'bin', 'converter')) {
  prepareWindowsResources(true);
  const output = resolve(packageDirectory, moduleRelativePath);
  if (!output.startsWith(resolve(root, 'bin') + sep)) throw new Error('Converter output must stay inside the project bin directory.');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const executable = join(output, process.platform === 'win32' ? 'LunaNahida.Converter.exe' : 'LunaNahida.Converter');
  const build = spawnSync('go', ['build', '-trimpath', '-o', executable, './cmd/music-restore'], { cwd: root, stdio: 'inherit', shell: false });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Converter build failed (${build.status}).`);
  verifyWindowsVersion(executable);
  const handshake = spawnSync(executable, ['--describe'], { cwd: root, encoding: 'utf8', shell: false, timeout: 5000 });
  if (handshake.error || handshake.status !== 0) throw new Error('Cannot verify the built converter.');
  const description = JSON.parse(handshake.stdout);
  if (description.version !== version) throw new Error('Converter version does not match VERSION.');

  const licenses = join(output, 'LICENSES');
  mkdirSync(licenses, { recursive: true });
  const dependencies = spawnSync('go', ['list', '-deps', '-f', '{{if not .Standard}}{{if .Module}}{{.Module.Path}}|{{.Module.Dir}}{{end}}{{end}}', './cmd/music-restore'], { cwd: root, encoding: 'utf8', shell: false });
  if (dependencies.error) throw dependencies.error;
  if (dependencies.status !== 0) throw new Error(dependencies.stderr || 'Cannot enumerate converter licenses.');
  for (const dependency of new Set(dependencies.stdout.trim().split(/\r?\n/).filter(Boolean))) {
    const [moduleName, directory] = dependency.split('|');
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name)) {
        cpSync(join(directory, entry.name), join(licenses, `${moduleName.replaceAll('/', '_')}-${entry.name}`));
      }
    }
  }
  writeFileSync(join(output, 'README.txt'), `LunaNahida 加密音乐还原模块 ${version}（协议 ${description.protocol}）\n\n安装：退出播放器，将 modules 文件夹复制到 LunaNahida.exe 所在目录，重新启动。\n卸载：退出播放器，删除 modules/music-restore 目录。\n只提供现有加密音乐还原；不提供音频转码。\n独立使用：LunaNahida.Converter restore "加密文件路径" --output-dir "输出目录"\n独立使用默认保留源文件，已有目标文件不会被覆盖。\n不需要播放器、Go、Node.js 或 WebView2。\n\n许可证见 LICENSES 文件夹。\n`, 'utf8');
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Converter package: ${buildConverter()}`);
}
