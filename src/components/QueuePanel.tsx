import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { AudioLines, Info, List, ListMusic, Music2, Play, Rows3, Trash2 } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatTime, type Track } from '@/lib/music';
import type { usePlayer } from '@/hooks/use-player';

type Player = ReturnType<typeof usePlayer>;
type Props = { player: Player; onViewInfo: (track: Track) => void };

export default function QueuePanel({ player: p, onViewInfo }: Props) {
  const [tab, setTab] = useState<'queue' | 'details'>('queue');
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const onDrop = (event: DragEvent, id: number) => {
    if (!event.dataTransfer.types.includes('application/x-lumatune-track')) return;
    event.preventDefault(); event.stopPropagation();
    if (dragged !== null) p.move(dragged, id);
    setDragged(null); setOver(null);
  };
  const remove = (id: number) => { p.removeTrack(id); setSelected(null); };
  const onRowKeyDown = (event: KeyboardEvent, id: number) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); remove(id);
    }
  };
  return <aside className="queue-panel">
    <div className="queue-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>播放队列 <span>{p.queue.length}</span></button><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>曲目信息</button><ListMusic size={16} /></div>
    {tab === 'queue' ? <>
      <div className="queue-description"><div><span>{p.queue.length} 首歌曲</span><button type="button" className="queue-density" title={compact ? '切换为普通展示' : '切换为单行紧凑展示'} aria-label={compact ? '切换为普通展示' : '切换为单行紧凑展示'} aria-pressed={compact} onClick={() => setCompact(value => !value)}>{compact ? <Rows3 size={17} /> : <List size={17} />}</button></div><small>{p.mode === 'shuffle' ? '随机播放' : p.mode === 'repeat' ? '单曲循环' : '顺序播放'}</small></div>
      <div className={`queue-list ${compact ? 'is-compact' : ''}`}>{p.queue.map((t, i) => <ContextMenu key={t.id}><ContextMenuTrigger asChild><div className={`queue-sortable ${over === t.id ? 'drop-target' : ''} ${selected === t.id ? 'selected' : ''}`} draggable onContextMenu={() => setSelected(t.id)} onKeyDown={event => onRowKeyDown(event, t.id)} onDragStart={event => { setDragged(t.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-lumatune-track', String(t.id)); }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-lumatune-track')) { event.preventDefault(); setOver(t.id); } }} onDragLeave={() => setOver(null)} onDrop={event => onDrop(event, t.id)} onDragEnd={() => { setDragged(null); setOver(null); }}><button className={`queue-track ${p.trackId === t.id ? 'current' : ''}`} onClick={() => { setSelected(t.id); p.select(t.id); }}><span className="track-number">{p.trackId === t.id ? <AudioLines size={14} /> : String(i + 1).padStart(2, '0')}</span><img src={t.cover} alt="" /><span className="queue-track-label"><span>{t.title}</span>{(!compact || t.artist !== '本地文件') && <small>{t.artist}</small>}</span><span className="track-duration">{formatTime(t.duration)}</span></button></div></ContextMenuTrigger><ContextMenuContent className="queue-context"><ContextMenuItem onSelect={() => { setSelected(t.id); p.select(t.id); }}><Play size={15} />立即播放</ContextMenuItem><ContextMenuItem onSelect={() => onViewInfo(t)}><Info size={15} />查看信息</ContextMenuItem><ContextMenuItem className="queue-context-danger" onSelect={() => remove(t.id)}><Trash2 size={15} />从列表删除</ContextMenuItem></ContextMenuContent></ContextMenu>)}</div>
      {!p.queue.length && <div className="queue-empty"><Music2 size={25} /><span>队列为空</span></div>}
      {p.queue.length > 0 && <div className="queue-actions"><button onClick={() => { p.clearQueue(); setSelected(null); }} title="清空播放队列" aria-label="清空播放队列"><Trash2 size={16} />清空队列</button></div>}
    </> : p.hasTrack ? <div className="inline-details"><img src={p.track.cover} alt="专辑封面" /><h3>{p.track.title}</h3><p>{p.track.artist}</p><dl>{[['专辑', p.track.album], ['风格', p.track.genre], ['发行', p.track.year], ['时长', formatTime(p.track.duration)], ['音频', p.track.source ? '本地文件' : '演示音频']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div> : <div className="queue-empty">队列为空</div>}
  </aside>;
}
