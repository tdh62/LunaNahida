import { spawnSync } from 'node:child_process';
import { mkdirSync, cpSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { binOutput, projectRoot } from './version.mjs';

export const moduleRelativePath = join('modules', 'music-restore');
export const converterSource = join(projectRoot, 'extensions/music-restore');
const contract = JSON.parse(readFileSync(join(projectRoot, 'docs/music-restore-contract.json'), 'utf8'));

export function assertConverterSource() {
  if (!existsSync(join(converterSource, 'go.mod')) || !existsSync(join(converterSource, 'scripts/build-converter.mjs'))) {
    throw new Error('还原模块源码未初始化。请使用有权限的 Git 凭据执行 git submodule update --init -- extensions/music-restore；只构建播放器可使用 build:desktop 或 build:release:lean。');
  }
  const snapshot = JSON.parse(readFileSync(join(converterSource, 'docs/music-restore-contract.json'), 'utf8'));
  if (JSON.stringify(snapshot) !== JSON.stringify(contract)) throw new Error('还原模块的协议契约与播放器不一致，请更新兼容的子模块提交。');
}

export function describeConverter(executable) {
  const handshake = spawnSync(executable, ['--describe'], { encoding: 'utf8', shell: false, timeout: 5000 });
  if (handshake.error || handshake.status !== 0) throw new Error('Cannot verify the built converter.');
  const info = JSON.parse(handshake.stdout);
  if (info.module !== contract.module || info.protocol !== contract.protocol || info.classificationRevision !== contract.classificationRevision || !info.operations?.includes('restore')) {
    throw new Error('Built converter does not implement the player restoration contract.');
  }
  return info;
}

export function converterRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: converterSource, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw new Error('Cannot read the converter source commit.');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: converterSource, encoding: 'utf8', shell: false });
  if (status.error || status.status !== 0) throw new Error('Cannot inspect converter source changes.');
  return { commit: result.stdout.trim(), dirty: status.stdout.trim() !== '' };
}

export function buildConverter(packageDirectory = join(projectRoot, 'bin/converter')) {
  assertConverterSource();
  const output = binOutput(resolve(packageDirectory, moduleRelativePath));
  const build = spawnSync(process.execPath, [join(converterSource, 'scripts/build-converter.mjs')], { cwd: converterSource, stdio: 'inherit', shell: false });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Converter build failed (${build.status}).`);
  const source = join(converterSource, 'bin/converter', moduleRelativePath);
  describeConverter(join(source, process.platform === 'win32' ? 'LunaNahida.Converter.exe' : 'LunaNahida.Converter'));
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(source, output, { recursive: true });
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`Converter package: ${buildConverter()}`);
}
