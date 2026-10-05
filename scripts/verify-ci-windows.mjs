import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './version.mjs';
import { dictionaryFiles } from './search-dictionary.mjs';
import { describeConverter, moduleRelativePath } from './build-converter.mjs';

const output = join(projectRoot, 'bin/ci-windows');
const flavors = ['desktop', 'portable'];
if (process.argv.includes('--with-converter')) flavors.push('desktop-unlock-music', 'portable-unlock-music');
assert.deepEqual(readdirSync(output).sort(), [...flavors].sort(), 'Unexpected CI package variants.');
const dictionaryNames = [...await dictionaryFiles(), 'manifest.json', 'LICENSE-2.0.txt', 'NOTICE.md'];

function nonemptyFile(file) {
  const info = statSync(file);
  assert.ok(info.isFile() && info.size > 0, `Missing or empty file: ${file}`);
}

for (const flavor of flavors) {
  const root = join(output, flavor);
  const portable = flavor.startsWith('portable');
  const withConverter = flavor.endsWith('-unlock-music');
  const expected = ['LunaNahida.exe', 'search-dict', ...(portable ? ['WebView2'] : []), ...(withConverter ? ['modules'] : [])];
  assert.deepEqual(readdirSync(root).sort(), expected.sort(), `Unexpected contents in ${flavor}.`);
  nonemptyFile(join(root, 'LunaNahida.exe'));
  const dictionary = join(root, 'search-dict');
  assert.deepEqual(readdirSync(dictionary).sort(), [...dictionaryNames].sort(), `Unexpected dictionary files in ${flavor}.`);
  for (const name of dictionaryNames) nonemptyFile(join(dictionary, name));
  assert.equal(JSON.parse(readFileSync(join(dictionary, 'manifest.json'), 'utf8')).available, true);
  if (portable) {
    nonemptyFile(join(root, 'WebView2/msedgewebview2.exe'));
    nonemptyFile(join(root, 'WebView2/EBWebView/x64/EmbeddedBrowserWebView.dll'));
  }
  if (withConverter) {
    assert.deepEqual(readdirSync(join(root, 'modules')), ['music-restore']);
    const module = join(root, moduleRelativePath);
    assert.deepEqual(readdirSync(module).sort(), ['LICENSES', 'LunaNahida.Converter.exe']);
    nonemptyFile(join(module, 'LunaNahida.Converter.exe'));
    assert.ok(readdirSync(join(module, 'LICENSES')).length > 0, 'Missing converter dependency licenses.');
    describeConverter(join(module, 'LunaNahida.Converter.exe'));
  }
  console.log(`Verified CI package: ${flavor}`);
}
