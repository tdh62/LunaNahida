export function getVirtualTrackRange(total: number, rowHeight: number, viewportHeight: number, scrollTop: number, overscan: number) {
  const totalHeight = total * rowHeight;
  const clampedScrollTop = Math.max(0, Math.min(scrollTop, totalHeight - viewportHeight));
  const start = Math.max(0, Math.floor(clampedScrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((clampedScrollTop + viewportHeight) / rowHeight) + overscan);
  return { start, end, totalHeight, topHeight: start * rowHeight, bottomHeight: (total - end) * rowHeight };
}

export function getVirtualTrackLocation(index: number, total: number, rowHeight: number, viewportHeight: number) {
  if (index < 0 || index >= total) return null;
  const scrollTop = Math.max(0, Math.min(index * rowHeight - (viewportHeight - rowHeight) / 2, total * rowHeight - viewportHeight));
  return { scrollTop };
}

export function locateCurrentTrack(list: HTMLElement | null) {
  const row = list?.querySelector<HTMLElement>('.library-row.is-current, .queue-track.current');
  if (!list || !row) return false;
  const listBounds = list.getBoundingClientRect();
  const rowBounds = row.getBoundingClientRect();
  list.scrollTop = Math.max(0, list.scrollTop + rowBounds.top - listBounds.top - list.clientTop - (list.clientHeight - rowBounds.height) / 2);
  row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  row.focus({ preventScroll: true });
  return true;
}
