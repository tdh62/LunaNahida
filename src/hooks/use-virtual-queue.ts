import { useLayoutEffect, useMemo, useRef, useState, type RefObject, type UIEvent } from 'react';
import { getVirtualTrackLocation, getVirtualTrackRange, locateCurrentTrack } from '@/lib/track-location';
import type { Track } from '@/lib/music';

export function useVirtualQueue(list: RefObject<HTMLDivElement | null>, tracks: Track[], rowHeightHint: number, enabled = true) {
  const [viewport, setViewport] = useState({ height: 400, rowHeight: rowHeightHint });
  const [scrollTop, setScrollTopState] = useState(0);
  const rememberedScroll = useRef(0);
  const setScrollTop = (value: number) => { rememberedScroll.current = value; setScrollTopState(value); };
  const [locating, setLocating] = useState<number | null>(null);
  const positions = useMemo(() => new Map(tracks.map((track, index) => [track.id, index])), [tracks]);
  const virtualized = tracks.length > 200;
  const range = getVirtualTrackRange(tracks.length, viewport.rowHeight, viewport.height, scrollTop, 8);
  const start = virtualized ? range.start : 0;
  const end = virtualized ? range.end : tracks.length;
  const hint = useRef(rowHeightHint);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !enabled) return;
    element.scrollTop = rememberedScroll.current;
    const measure = () => {
      const row = element.querySelector<HTMLElement>('.queue-track');
      const rowHeight = hint.current !== rowHeightHint ? rowHeightHint : row?.getBoundingClientRect().height || rowHeightHint;
      hint.current = rowHeightHint;
      const height = element.clientHeight || 400;
      setViewport(previous => previous.height === height && previous.rowHeight === rowHeight ? previous : { height, rowHeight });
      setScrollTop(element.scrollTop);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, list, rowHeightHint, tracks.length, virtualized]);
  const locate = (id: number | null) => {
    const element = list.current;
    const index = id === null ? undefined : positions.get(id);
    if (!element || index === undefined) return;
    if (!virtualized) { locateCurrentTrack(element); return; }
    const location = getVirtualTrackLocation(index, tracks.length, viewport.rowHeight, element.clientHeight);
    if (!location) return;
    element.scrollTop = location.scrollTop;
    setScrollTop(location.scrollTop);
    setLocating(id);
  };
  useLayoutEffect(() => {
    if (locating === null) return;
    const row = list.current?.querySelector<HTMLElement>(`.queue-track[data-track-id="${locating}"]`);
    if (row) row.focus({ preventScroll: true });
    setLocating(null);
  }, [locating, start, end, list]);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !enabled) return;
    const maximum = Math.max(0, tracks.length * viewport.rowHeight - element.clientHeight);
    if (virtualized && element.scrollTop > maximum) element.scrollTop = maximum;
    setScrollTop(element.scrollTop);
  }, [tracks.length, viewport.rowHeight, enabled, virtualized, list]);
  return {
    virtualized, start, tracks: tracks.slice(start, end), rowHeight: viewport.rowHeight,
    top: virtualized ? range.topHeight : 0, bottom: virtualized ? range.bottomHeight : 0,
    onScroll: (event: UIEvent<HTMLDivElement>) => { if (event.currentTarget.getClientRects().length) setScrollTop(event.currentTarget.scrollTop); }, locate,
  };
}
