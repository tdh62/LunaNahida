import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { binOutput, projectRoot } from './version.mjs';
import { assertConverterSource, buildConverter, moduleRelativePath } from './build-converter.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('CI packages require Windows x64.');
const withConverter = process.argv.includes('--with-converter');
if (withConverter) assertConverterSource();
const output = binOutput(join(projectRoot, 'bin/ci-windows'));

// This directory contains only CI staging files, never portable userdata.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const flavor of ['desktop', 'portable']) {
  const result = spawnSync(process.execPath, [join(projectRoot, `scripts/build-${flavor}.mjs`), '--output-dir', join(output, flavor)], { cwd: projectRoot, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${flavor} build failed (${result.status}).`);
}

if (withConverter) {
  const converter = buildConverter(join(projectRoot, 'bin/ci-converter'));
  for (const flavor of ['desktop', 'portable']) {
    const full = join(output, `${flavor}-unlock-music`);
    cpSync(join(output, flavor), full, { recursive: true });
    const module = join(full, moduleRelativePath);
    cpSync(converter, module, { recursive: true });
    rmSync(join(module, 'README.txt'), { force: true });
  }
}

const verification = spawnSync(process.execPath, [join(projectRoot, 'scripts/verify-ci-windows.mjs'), ...(withConverter ? ['--with-converter'] : [])], { cwd: projectRoot, stdio: 'inherit', shell: false });
if (verification.error) throw verification.error;
if (verification.status !== 0) throw new Error(`CI artifact verification failed (${verification.status}).`);
