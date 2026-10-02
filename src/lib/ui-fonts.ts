export const defaultUIFontStack = '"DM Sans", "Noto Sans SC", sans-serif';

// Quote every family: commas and CSS keywords in a name must remain literal.
export function uiFontStack(families: string[]): string {
  return [...families.map(family => JSON.stringify(family)), defaultUIFontStack].join(', ');
}
