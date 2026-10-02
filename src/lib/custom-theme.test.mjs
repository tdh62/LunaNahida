import test from 'node:test';
import assert from 'node:assert/strict';
import { customTheme, defaultThemeColor } from './custom-theme.ts';

function luminance(hsl) {
  const [hue, saturation, lightness] = hsl.match(/[\d.]+/g).map(Number);
  const s = saturation / 100, l = lightness / 100;
  return [0, 8, 4].reduce((sum, offset, index) => {
    const k = (offset + hue / 30) % 12;
    const value = l - s * Math.min(l, 1-l) * Math.max(-1, Math.min(k-3, 9-k, 1));
    return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
  }, 0);
}
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);

test('custom palettes keep readable text and light button labels for extreme base colors', () => {
  for (const base of ['#ffffff', '#000000', '#808080', '#ffff00', '#00ff00', '#0000ff', '#ff0000', '#ff00ff', '#007aff']) {
    for (const mode of ['light', 'dark']) {
      const colors = customTheme(base, mode);
      assert.ok(contrast(luminance(colors['--page-background']), luminance(colors['--text-primary'])) >= 7, `${base} ${mode} text`);
      assert.ok(contrast(luminance(colors['--panel-background']), luminance(colors['--text-secondary'])) >= 4.5, `${base} ${mode} secondary text`);
      if (mode === 'light') assert.ok(contrast(1, luminance(colors['--theme-accent'])) >= 4.5, `${base} button label`);
    }
  }
  assert.deepEqual(customTheme('invalid', 'light'), customTheme(defaultThemeColor, 'light'));
});
