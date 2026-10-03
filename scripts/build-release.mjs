import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { version, projectRoot, binOutput, synchronizeVersion } from './version.mjs';
import { assertConverterSource, buildConverter, describeConverter, converterRevision } from './build-converter.mjs';

// Only dedicated staging directories are cleared. Existing portable userdata is never read.
synchronizeVersion();
const leanOnly = process.argv.includes('--lean-only');
if (!leanOnly) assertConverterSource();
const platform = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const output = binOutput(join(projectRoot, 'bin/releases', version, ...(leanOnly ? ['lean-only'] : [])));
const staging = binOutput(join(projectRoot, 'bin/release-staging', version));
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(output, { recursive: true });

function run(program, args) {
  const result = spawnSync(program, args, { cwd: projectRoot, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status}).`);
}

run(process.execPath, [join(projectRoot, 'node_modules/vite/bin/vite.js'), 'build']);
const lean = join(staging, 'lean');
const full = join(staging, 'full');
const modulePackage = join(staging, 'converter');
run(process.execPath, [join(projectRoot, 'scripts/build-desktop.mjs'), '--output-dir', lean]);
const variants = [{ flavor: 'lean', path: lean }];
let moduleInfo = null;
let moduleSource = null;
if (!leanOnly) {
  buildConverter(modulePackage);
  cpSync(lean, full, { recursive: true });
  cpSync(join(modulePackage, 'modules'), join(full, 'modules'), { recursive: true });
  variants.push({ flavor: 'full', path: full }, { flavor: 'converter', path: modulePackage });
  moduleInfo = describeConverter(join(modulePackage, 'modules/music-restore', process.platform === 'win32' ? 'LunaNahida.Converter.exe' : 'LunaNahida.Converter'));
  moduleSource = converterRevision();
}
if (process.argv.includes('--portable')) {
  const portable = join(staging, 'portable-lean');
  const portableFull = join(staging, 'portable-full');
  run(process.execPath, [join(projectRoot, 'scripts/build-portable.mjs'), '--output-dir', portable]);
  variants.push({ flavor: 'portable-lean', path: portable });
  if (!leanOnly) {
    cpSync(portable, portableFull, { recursive: true });
    cpSync(join(modulePackage, 'modules'), join(portableFull, 'modules'), { recursive: true });
    variants.push({ flavor: 'portable-full', path: portableFull });
  }
}

const introduction = `LunaNahida ${version}\n\n精简版：不包含加密音乐还原模块。\n完整版：包含还原模块；不提供音频转码。\n独立模块：把 modules 文件夹解压到播放器 EXE 旁边，重启启用。\n桌面版运行需要 WebView2；便携版已附带运行环境，首次运行会创建 userdata。\n更新便携版时保留已有 userdata；分发包中不包含用户数据。\nsearch-dict 目录用于日文读音搜索，建议与播放器一起保留。\nMANIFEST.json 列出包内文件及 SHA-256 校验值；压缩包校验值见 SHA256SUMS.txt。\n\n还原中断：工具箱 → 文件恢复。批量还原可取消、继续剩余任务或仅重试失败项。\n安装说明：MUSIC-RESTORE.md。\n`;
const artifacts = [];
for (const variant of variants) {
  if (variant.flavor !== 'converter') writeFileSync(join(variant.path, 'README.txt'), introduction);
  cpSync(join(projectRoot, 'docs/music-restore.md'), join(variant.path, 'MUSIC-RESTORE.md'));
  const prefix = variant.flavor === 'converter' ? 'LunaNahida.Converter' : 'LunaNahida';
  const artifactVersion = variant.flavor === 'converter' ? moduleInfo.version : version;
  const name = `${prefix}-${artifactVersion}-${platform}-${variant.flavor}.zip`;
  const archive = join(output, name);
  run('go', ['run', './cmd/release-pack', '--source', variant.path, '--output', archive, '--flavor', variant.flavor, '--version', artifactVersion]);
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  artifacts.push({ file: name, flavor: variant.flavor, version: artifactVersion, size: statSync(archive).size, sha256: digest });
}
writeFileSync(join(output, 'SHA256SUMS.txt'), artifacts.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
writeFileSync(join(output, 'release.json'), JSON.stringify({ version, platform, module: moduleInfo, moduleSource, artifacts }, null, 2) + '\n');
writeFileSync(join(output, 'README.txt'), introduction);
console.log(`Release packages: ${output}\n${readdirSync(output).join('\n')}`);
