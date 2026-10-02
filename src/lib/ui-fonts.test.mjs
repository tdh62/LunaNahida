import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultUIFontStack, uiFontStack } from './ui-fonts.ts';

test('font priority and default fallback are preserved, names are quoted literally', () => {
  assert.equal(uiFontStack([]), defaultUIFontStack);
  assert.equal(uiFontStack(['Segoe UI', 'Microsoft YaHei']), '"Segoe UI", "Microsoft YaHei", ' + defaultUIFontStack);
  assert.equal(uiFontStack(['Example, Font', 'serif', 'A"B']), '"Example, Font", "serif", "A\\"B", ' + defaultUIFontStack);
});
