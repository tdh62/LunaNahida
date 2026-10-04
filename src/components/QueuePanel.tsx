import { useVirtualQueue } from '@/hooks/use-virtual-queue';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { AudioLines, Info, List, ListMusic, Music2, Play, RefreshCw, Rows3, Save, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatTime, type Track } from '@/lib/music';
import { useRuntime } from '@/hooks/use-runtime';
import { isBrowserTrack } from '@/lib/browser-tracks';
import { hasTrackDrag, readTrackDrag, writeTrackDrag } from '@/lib/track-drag';
import type { usePlayer } from '@/hooks/use-player';
import LocateCurrentTrackButton from '@/components/LocateCurrentTrackButton';
import { locateCurrentTrack } from '@/lib/track-location';

type Player = ReturnType<typeof usePlayer>;
type Props = { player: Player; onViewInfo: (track: Track) => void; onRefreshInfo: (track: Track) => void; onSaveLyrics: (track: Track) => void; onSaveQueue: () => void; onAddTracks: (ids: number[]) => void };

export default function QueuePanel({ player: p, onViewInfo, onRefreshInfo, onSaveLyrics, onSaveQueue, onAddTracks }: Props) {
  const runtime = useRuntime();
  const [tab, setTab] = useState<'queue' | 'details'>('queue');
  const [compact, setCompact] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const anchor = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualQueue(listRef, p.queue, compact ? 36 : 49, tab === 'queue');
  const previousList = useRef<HTMLDivElement>(null);
  const lastTrackId = useRef(p.trackId);
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [overDelete, setOverDelete] = useState(false);
  const [overExternal, setOverExternal] = useState(false);
  const queuedIds = useMemo(() => new Set(p.queue.map(track => track.id)), [p.queue]);
  const selected = selectedIds.filter(id => queuedIds.has(id));
  const selectedSet = new Set(selected);
  const selectedTracks = p.queue.filter(track => selectedSet.has(track.id) && track.available !== false && track.playbackStatus !== 'unplayable');

  useLayoutEffect(() => {
    const list = listRef.current;
    const entering = list !== null && list !== previousList.current;
    previousList.current = list;
    if (!list || (!entering && lastTrackId.current === p.trackId)) return;
    lastTrackId.current = p.trackId;
    if (p.trackId === null || (!entering && selected.length > 1) || !p.queue.some(track => track.id === p.trackId)) return;

    setSelectedIds([p.trackId]);
    anchor.current = p.trackId;
    if (document.querySelector('.quick-queue-panel')) return;
    if (virtual.virtualized) { virtual.locate(p.trackId); return; }
    const row = list?.querySelector<HTMLButtonElement>('.queue-track.current');
    if (!list || !row) return;
    row.focus({ preventScroll: true });
    const listBounds = list.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.top < listBounds.top) list.scrollTop -= listBounds.top - rowBounds.top;
    else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
  }, [p.trackId, p.queue, selected.length, tab]);

  useEffect(() => {
    const selectAll = (event: globalThis.KeyboardEvent) => {
      if (tab !== 'queue' || event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a' || !p.queue.length) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setSelectedIds(p.queue.map(track => track.id));
    };
    document.addEventListener('keydown', selectAll);
    return () => document.removeEventListener('keydown', selectAll);
  });

  const selectRow = (event: MouseEvent, id: number) => {
    if (event.shiftKey && anchor.current !== null) {
      const from = p.queue.findIndex(track => track.id === anchor.current);
      const to = p.queue.findIndex(track => track.id === id);
      if (from !== -1) {
        const range = p.queue.slice(Math.min(from, to), Math.max(from, to) + 1).map(track => track.id);
        setSelectedIds(event.ctrlKey || event.metaKey ? [...new Set([...selected, ...range])] : range);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) setSelectedIds(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
    else setSelectedIds([id]);
    anchor.current = id;
  };
  const removeSelected = (ids: number[]) => {
    p.removeTracks(ids);
    setSelectedIds(current => current.filter(id => !ids.includes(id)));
    if (anchor.current !== null && ids.includes(anchor.current)) anchor.current = null;
  };
  const onDrop = (event: DragEvent, id: number) => {
    if (!hasTrackDrag(event.dataTransfer) || dragged === null) return;
    event.preventDefault(); event.stopPropagation();
    if (dragged !== null) p.move(dragged, id);
    setDragged(null); setOver(null);
  };
  const onRowKeyDown = (event: KeyboardEvent, id: number) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); setSelectedIds(p.queue.map(track => track.id)); return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation();
      removeSelected(selected.includes(id) ? selected : [id]);
    }
    if (event.key === 'Enter') { event.preventDefault(); p.select(id); }
  };
  return <aside className={`queue-panel ${overExternal ? 'track-drop-target' : ''}`} onDragOver={event => { if (tab !== 'queue' || dragged !== null || !hasTrackDrag(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setOverExternal(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOverExternal(false); }} onDrop={event => { if (tab !== 'queue' || dragged !== null || !hasTrackDrag(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); setOverExternal(false); onAddTracks(readTrackDrag(event.dataTransfer)); }}>
    <div className="queue-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>播放队列 <span>{p.queue.length}</span></button><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>曲目信息</button><ListMusic size={16} /></div>
    {tab === 'queue' ? <>
      <div className="queue-description"><div><span>{p.queue.length} 首歌曲{selected.length > 0 && ` · 已选 ${selected.length} 首`}</span><span className="queue-view-actions"><LocateCurrentTrackButton iconOnly available={p.trackId !== null && p.queue.some(track => track.id === p.trackId)} onLocate={() => virtual.locate(p.trackId)} /><button type="button" className="queue-density" title={compact ? '切换为普通展示' : '切换为单行紧凑展示'} aria-label={compact ? '切换为普通展示' : '切换为单行紧凑展示'} aria-pressed={compact} onClick={() => setCompact(value => !value)}>{compact ? <Rows3 size={17} /> : <List size={17} />}</button></span></div><small>{({ list: '列表循环', repeat: '单曲循环', shuffle: '随机播放', 'stop-track': '播完单曲停止', 'stop-list': '播完列表停止' })[p.mode]}</small></div>
      <div ref={listRef} onScroll={virtual.onScroll} style={{ '--queue-row-height': `${virtual.rowHeight}px` } as React.CSSProperties} className={`queue-list ${compact ? 'is-compact' : ''} ${virtual.virtualized ? 'is-virtualized' : ''}`}>{virtual.top > 0 && <div aria-hidden="true" style={{ height: virtual.top }} />}{virtual.tracks.map((t, offset) => <ContextMenu key={t.id}><ContextMenuTrigger asChild><div className={`queue-sortable ${over === t.id ? 'drop-target' : ''} ${selected.includes(t.id) ? 'selected' : ''}`} draggable onContextMenu={() => { if (!selected.includes(t.id)) { setSelectedIds([t.id]); anchor.current = t.id; } }} onKeyDown={event => onRowKeyDown(event, t.id)} onDragStart={event => { setDragged(t.id); writeTrackDrag(event.dataTransfer, selected.includes(t.id) ? selected : [t.id]); }} onDragOver={event => { if (dragged !== null && hasTrackDrag(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(t.id); } }} onDragLeave={() => setOver(null)} onDrop={event => onDrop(event, t.id)} onDragEnd={() => { setDragged(null); setOver(null); setOverDelete(false); }}><button type="button" data-track-id={t.id} className={`queue-track ${p.trackId === t.id ? 'current' : ''}`} aria-pressed={selected.includes(t.id)} onClick={event => selectRow(event, t.id)} onDoubleClick={() => p.select(t.id)}><span className="track-number">{p.trackId === t.id ? <AudioLines size={14} /> : String(virtual.start + offset + 1).padStart(2, '0')}</span><img src={t.cover} alt="" /><span className="queue-track-label"><span>{t.title}</span>{(!compact || t.artist !== '本地文件') && <small>{t.artist}</small>}</span><span className="track-duration">{formatTime(t.duration)}</span></button></div></ContextMenuTrigger><ContextMenuContent className="queue-context">{selected.length > 1 && selected.includes(t.id) && <ContextMenuItem disabled={!selectedTracks.length} onSelect={() => p.playTracks(selectedTracks)}><Play size={15} />播放所选 ({selectedTracks.length})</ContextMenuItem>}{selected.length <= 1 && <><ContextMenuItem onSelect={() => p.select(t.id)}><Play size={15} />立即播放</ContextMenuItem><ContextMenuItem onSelect={() => onViewInfo(t)}><Info size={15} />查看信息</ContextMenuItem>{t.source && <ContextMenuItem disabled={!runtime.backend} onSelect={() => onRefreshInfo(t)}><RefreshCw size={15} />立即刷新信息</ContextMenuItem>}{t.path && !isBrowserTrack(t) && t.lyrics?.trim() && !t.localLyrics && t.available !== false && <ContextMenuItem disabled={!runtime.backend} onSelect={() => onSaveLyrics(t)}><Save size={15} />保存歌词</ContextMenuItem>}</>}<ContextMenuItem className="queue-context-danger" onSelect={() => removeSelected(selected.includes(t.id) ? selected : [t.id])}><Trash2 size={15} />{selected.length > 1 ? `从列表删除 ${selected.length} 首` : '从列表删除'}</ContextMenuItem></ContextMenuContent></ContextMenu>)}{virtual.bottom > 0 && <div aria-hidden="true" style={{ height: virtual.bottom }} />}</div>
      {!p.queue.length && <div className="queue-empty"><Music2 size={25} /><span>队列为空</span></div>}
      {p.queue.length > 0 && <div className="queue-actions"><button type="button" onClick={onSaveQueue} disabled={!p.queue.some(track => track.id > 0 && !track.temporary)} title={p.queue.some(track => track.id > 0 && !track.temporary) ? '将播放队列保存为歌单' : '临时歌曲不能保存为歌单'}><Save size={16} />存为歌单</button><div className={`queue-delete-zone ${overDelete ? 'is-over' : ''}`} onDragOver={event => { if (dragged !== null && hasTrackDrag(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setOverDelete(true); } }} onDragLeave={event => { if (event.target === event.currentTarget) setOverDelete(false); }} onDrop={event => { if (dragged === null || !hasTrackDrag(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); const ids = readTrackDrag(event.dataTransfer); removeSelected(ids); setDragged(null); setOver(null); setOverDelete(false); }}><AlertDialog><AlertDialogTrigger asChild><button type="button" title="清空播放队列" aria-label="清空播放队列"><Trash2 size={16} />{overDelete ? '松开移除歌曲' : '清空队列'}</button></AlertDialogTrigger><AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-lg border-[#3a3b3e] bg-[#202123] text-[#efeeea]"><AlertDialogHeader><AlertDialogTitle className="text-base text-[#efeeea]">清空播放队列？</AlertDialogTitle><AlertDialogDescription className="text-[#b6b5b8]">将移除队列中的 {p.queue.length} 首歌曲并停止播放。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter className="gap-2 sm:space-x-0"><AlertDialogCancel className="mt-0 rounded-md border-[#55565a] bg-transparent text-[#efeeea] hover:bg-[#323338] hover:text-white">取消</AlertDialogCancel><AlertDialogAction className="rounded-md bg-[#ab424d] text-white hover:bg-[#943540]" onClick={() => { p.clearQueue(); setSelectedIds([]); anchor.current = null; }}>确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>}
    </> : p.hasTrack ? <div className="inline-details"><img src={p.track.cover} alt="专辑封面" /><h3>{p.track.title}</h3><p>{p.track.artist}</p><dl>{[['专辑', p.track.album], ['风格', p.track.genre || '未标注'], ['发行', p.track.year || '未知'], ['时长', formatTime(p.track.duration)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div> : <div className="queue-empty">队列为空</div>}
  </aside>;
}
