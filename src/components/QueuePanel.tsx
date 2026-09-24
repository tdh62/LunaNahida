import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { AudioLines, Info, List, ListMusic, Music2, Play, Rows3, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatTime, type Track } from '@/lib/music';
import type { usePlayer } from '@/hooks/use-player';

type Player = ReturnType<typeof usePlayer>;
type Props = { player: Player; onViewInfo: (track: Track) => void };

export default function QueuePanel({ player: p, onViewInfo }: Props) {
  const [tab, setTab] = useState<'queue' | 'details'>('queue');
  const [compact, setCompact] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const anchor = useRef<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const selected = selectedIds.filter(id => p.queue.some(track => track.id === id));

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
    if (!event.dataTransfer.types.includes('application/x-lumatune-track')) return;
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
  return <aside className="queue-panel">
    <div className="queue-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>播放队列 <span>{p.queue.length}</span></button><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>曲目信息</button><ListMusic size={16} /></div>
    {tab === 'queue' ? <>
      <div className="queue-description"><div><span>{p.queue.length} 首歌曲{selected.length > 0 && ` · 已选 ${selected.length} 首`}</span><button type="button" className="queue-density" title={compact ? '切换为普通展示' : '切换为单行紧凑展示'} aria-label={compact ? '切换为普通展示' : '切换为单行紧凑展示'} aria-pressed={compact} onClick={() => setCompact(value => !value)}>{compact ? <Rows3 size={17} /> : <List size={17} />}</button></div><small>{p.mode === 'shuffle' ? '随机播放' : p.mode === 'repeat' ? '单曲循环' : '顺序播放'}</small></div>
      <div className={`queue-list ${compact ? 'is-compact' : ''}`}>{p.queue.map((t, i) => <ContextMenu key={t.id}><ContextMenuTrigger asChild><div className={`queue-sortable ${over === t.id ? 'drop-target' : ''} ${selected.includes(t.id) ? 'selected' : ''}`} draggable onContextMenu={() => { if (!selected.includes(t.id)) { setSelectedIds([t.id]); anchor.current = t.id; } }} onKeyDown={event => onRowKeyDown(event, t.id)} onDragStart={event => { setDragged(t.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-lumatune-track', String(t.id)); }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-lumatune-track')) { event.preventDefault(); setOver(t.id); } }} onDragLeave={() => setOver(null)} onDrop={event => onDrop(event, t.id)} onDragEnd={() => { setDragged(null); setOver(null); }}><button type="button" className={`queue-track ${p.trackId === t.id ? 'current' : ''}`} aria-pressed={selected.includes(t.id)} onClick={event => selectRow(event, t.id)} onDoubleClick={() => p.select(t.id)}><span className="track-number">{p.trackId === t.id ? <AudioLines size={14} /> : String(i + 1).padStart(2, '0')}</span><img src={t.cover} alt="" /><span className="queue-track-label"><span>{t.title}</span>{(!compact || t.artist !== '本地文件') && <small>{t.artist}</small>}</span><span className="track-duration">{formatTime(t.duration)}</span></button></div></ContextMenuTrigger><ContextMenuContent className="queue-context">{selected.length <= 1 && <><ContextMenuItem onSelect={() => p.select(t.id)}><Play size={15} />立即播放</ContextMenuItem><ContextMenuItem onSelect={() => onViewInfo(t)}><Info size={15} />查看信息</ContextMenuItem></>}<ContextMenuItem className="queue-context-danger" onSelect={() => removeSelected(selected.includes(t.id) ? selected : [t.id])}><Trash2 size={15} />{selected.length > 1 ? `从列表删除 ${selected.length} 首` : '从列表删除'}</ContextMenuItem></ContextMenuContent></ContextMenu>)}</div>
      {!p.queue.length && <div className="queue-empty"><Music2 size={25} /><span>队列为空</span></div>}
      {p.queue.length > 0 && <div className="queue-actions"><AlertDialog><AlertDialogTrigger asChild><button type="button" title="清空播放队列" aria-label="清空播放队列"><Trash2 size={16} />清空队列</button></AlertDialogTrigger><AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-lg border-[#3a3b3e] bg-[#202123] text-[#efeeea]"><AlertDialogHeader><AlertDialogTitle className="text-base text-[#efeeea]">清空播放队列？</AlertDialogTitle><AlertDialogDescription className="text-[#b6b5b8]">将移除队列中的 {p.queue.length} 首歌曲并停止播放。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter className="gap-2 sm:space-x-0"><AlertDialogCancel className="mt-0 rounded-md border-[#55565a] bg-transparent text-[#efeeea] hover:bg-[#323338] hover:text-white">取消</AlertDialogCancel><AlertDialogAction className="rounded-md bg-[#ab424d] text-white hover:bg-[#943540]" onClick={() => { p.clearQueue(); setSelectedIds([]); anchor.current = null; }}>确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
    </> : p.hasTrack ? <div className="inline-details"><img src={p.track.cover} alt="专辑封面" /><h3>{p.track.title}</h3><p>{p.track.artist}</p><dl>{[['专辑', p.track.album], ['风格', p.track.genre], ['发行', p.track.year], ['时长', formatTime(p.track.duration)], ['音频', p.track.source ? '本地文件' : '演示音频']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div> : <div className="queue-empty">队列为空</div>}
  </aside>;
}
