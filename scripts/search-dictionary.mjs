import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const dictionaryRoot = dirname(createRequire(import.meta.url).resolve('kuromoji/package.json'));
export async function dictionaryFiles() {
  return (await readdir(join(dictionaryRoot, 'dict'))).filter(name => name.endsWith('.dat.gz'));
}

export async function copySearchDictionary(executableDirectory) {
  const target = join(executableDirectory, 'search-dict');
  await mkdir(target, { recursive: true });
  for (const name of await dictionaryFiles()) await copyFile(join(dictionaryRoot, 'dict', name), join(target, name));
  for (const name of ['LICENSE-2.0.txt', 'NOTICE.md']) await copyFile(join(dictionaryRoot, name), join(target, name));
  await writeFile(join(target, 'manifest.json'), JSON.stringify({ available: true }));
}
