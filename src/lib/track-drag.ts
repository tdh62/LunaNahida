export const TRACK_DRAG_TYPE = 'application/x-lumatune-track';

export function hasTrackDrag(data: DataTransfer) {
  return data.types.includes(TRACK_DRAG_TYPE);
}

export function writeTrackDrag(data: DataTransfer, ids: number[]) {
  data.effectAllowed = 'copyMove';
  data.setData(TRACK_DRAG_TYPE, JSON.stringify(ids));
}

export function readTrackDrag(data: DataTransfer): number[] {
  if (!hasTrackDrag(data)) return [];
  try {
    const value: unknown = JSON.parse(data.getData(TRACK_DRAG_TYPE));
    const ids = Array.isArray(value) ? value : [value];
    return [...new Set(ids.filter((id): id is number => Number.isSafeInteger(id)))];
  } catch {
    return [];
  }
}
