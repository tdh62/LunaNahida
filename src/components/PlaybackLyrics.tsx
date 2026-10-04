import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from 'react';
import type { PlaybackClock } from '@/lib/playback-clock';
import type { TimedLine } from '@/hooks/use-music-enrichment';
import { scrollToCurrentLyric } from '@/lib/lyric-scroll';

type Props = {
  clock: PlaybackClock; lines: TimedLine[]; trackId: number; duration: number; source: string;
  onSeek: (time: number) => void; scroll: string; showTranslation: boolean;
  style?: CSSProperties; immersive?: boolean;
};

export default function PlaybackLyrics({ clock, lines, trackId, duration, source, onSeek, scroll, showTranslation, style, immersive = false }: Props) {
  const getLine = useCallback(() => {
    if (lines.every(line => line.time === 0)) return 0;
    return Math.max(0, lines.reduce((index, line, i) => clock.getSnapshot() >= line.time ? i : index, 0));
  }, [clock, lines]);
  // Subscribe to the current line, rather than rendering the lyrics on every tick.
  const activeLine = useSyncExternalStore(clock.subscribe, getLine, getLine);
  const element = useRef<HTMLDivElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ pointerId: number; y: number; scrollTop: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const entering = useRef(true);
  const follow = () => {
    setBrowsing(false);
    if (followTimer.current) clearTimeout(followTimer.current);
  };
  const pauseFollow = () => {
    setBrowsing(true);
    if (followTimer.current) clearTimeout(followTimer.current);
    followTimer.current = setTimeout(() => setBrowsing(false), 5000);
  };
  useEffect(() => {
    follow();
    drag.current = null;
    suppressClick.current = false;
    return () => {
      if (followTimer.current) clearTimeout(followTimer.current);
      entering.current = true;
    };
  }, [trackId]);
  useLayoutEffect(() => {
    const windowElement = element.current;
    if (!windowElement || (browsing && !entering.current)) return;
    const row = windowElement.querySelectorAll<HTMLElement>(immersive ? 'p' : '.lyric-line')[activeLine];
    scrollToCurrentLyric(windowElement, row, entering.current || scroll === '即时' ? 'instant' : 'smooth');
    entering.current = false;
  }, [activeLine, browsing, scroll, trackId, immersive, style]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') { pauseFollow(); return; }
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, y: event.clientY, scrollTop: event.currentTarget.scrollTop, moved: false };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') { pauseFollow(); return; }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.abs(event.clientY - current.y) > 5) { current.moved = true; event.currentTarget.setPointerCapture(event.pointerId); }
    if (current.moved) { event.currentTarget.scrollTop = current.scrollTop + current.y - event.clientY; pauseFollow(); }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (drag.current.moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); }
    drag.current = null;
  };
  if (immersive) return <div ref={element}>{lines.map((line, i) => <p key={`${trackId}-${i}`} className={i === activeLine ? 'current' : ''}>{line.text}</p>)}</div>;
  return <div ref={element} className={`lyrics-window ${browsing ? 'is-browsing' : ''}`} style={style} onWheel={pauseFollow} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClickCapture={event => {
    if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
  }}><div className="lyrics-track">{lines.map((line, i) => <button key={`${trackId}-${i}`} className={`lyric-line ${i === activeLine ? 'current' : ''} ${Math.abs(i - activeLine) > 2 ? 'distant' : ''}`} onClick={() => {
    onSeek(Math.max(0, source ? line.time : i * (duration / (lines.length + 1) || 1)));
    follow();
  }}><span>{line.text}</span>{i === activeLine && showTranslation && line.translation && <small>{line.translation}</small>}</button>)}</div></div>;
}
