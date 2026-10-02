export const uiTextSizes = [90, 100, 110, 120, 125] as const;
export const defaultUITextSize = 100;

export function normalizeUITextSize(value: unknown): number {
  return typeof value === 'number' && uiTextSizes.some(size => size === value) ? value : defaultUITextSize;
}
