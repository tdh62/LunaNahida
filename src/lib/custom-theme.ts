export const defaultThemeColor = '#2b7651';
export const validThemeColor = (value: string) => /^#[\da-f]{6}$/i.test(value);

const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
const luminance = (channels: number[]) => channels.reduce((sum, value, index) => sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index], 0);
function hslRGB(hue: number, saturation: number, lightness: number) {
  return [0, 8, 4].map(offset => {
    const k = (offset + hue / 30) % 12;
    return lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
}

export function customTheme(base: string, appearance: 'light' | 'dark'): Record<string, string> {
  const channels = rgb(validThemeColor(base) ? base : defaultThemeColor);
  const max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const hue = delta ? ((max === channels[0] ? (channels[1] - channels[2]) / delta : max === channels[1] ? (channels[2] - channels[0]) / delta + 2 : (channels[0] - channels[1]) / delta + 4) * 60 + 360) % 360 : 0;
  const dark = appearance === 'dark';
  const tone = (s: number, l: number) => `${hue.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
  const color = (s: number, l: number) => `hsl(${tone(s, l)})`;
  let accentLightness = dark ? .78 : Math.min(lightness, .45);
  // Light buttons use white labels, including bright yellow or near-white base colors.
  while (!dark && 1.05 / (luminance(hslRGB(hue, saturation, accentLightness)) + .05) < 4.5) accentLightness -= .01;
  const accent = color(saturation, accentLightness);
  const surfaceSaturation = Math.min(saturation, .4);
  const page = color(surfaceSaturation, dark ? .09 : .975);
  const panel = color(surfaceSaturation, dark ? .135 : .992);
  const field = color(surfaceSaturation, dark ? .18 : .947);
  const text = color(Math.min(saturation, .25), dark ? .94 : .18);
  const muted = color(Math.min(saturation, .2), dark ? .72 : .39);
  const border = color(surfaceSaturation, dark ? .3 : .85);
  const highlight = color(surfaceSaturation, dark ? .22 : .915);
  return {
    '--theme-accent': accent, '--theme-tint': `hsl(${tone(saturation, accentLightness)} / .12)`, '--theme-glow': `hsl(${tone(saturation, accentLightness)} / .1)`,
    '--page-background': page, '--light-panel': panel, '--light-soft': field, '--light-text': text, '--light-muted': muted, '--light-line': border, '--light-highlight': highlight,
    '--light-track': color(surfaceSaturation, dark ? .32 : .77), '--sidebar-background': color(surfaceSaturation, dark ? .105 : .951), '--sidebar-highlight': highlight,
    '--text-primary': text, '--text-secondary': muted, '--panel-background': panel, '--field-background': field, '--border-color': border, '--action-color': accent,
    '--background': tone(surfaceSaturation, dark ? .09 : .975), '--foreground': tone(Math.min(saturation, .25), dark ? .94 : .18),
    '--card': tone(surfaceSaturation, dark ? .135 : .992), '--card-foreground': tone(Math.min(saturation, .25), dark ? .94 : .18),
    '--popover': tone(surfaceSaturation, dark ? .135 : .992), '--popover-foreground': tone(Math.min(saturation, .25), dark ? .94 : .18),
    '--secondary': tone(surfaceSaturation, dark ? .18 : .947), '--secondary-foreground': tone(Math.min(saturation, .25), dark ? .94 : .18),
    '--muted': tone(surfaceSaturation, dark ? .18 : .947), '--muted-foreground': tone(Math.min(saturation, .2), dark ? .72 : .39),
    '--border': tone(surfaceSaturation, dark ? .3 : .85), '--input': tone(surfaceSaturation, dark ? .3 : .85), '--ring': tone(saturation, accentLightness),
  };
}
