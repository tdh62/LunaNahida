import { useState, type DragEvent } from 'react';
import { AudioLines, FolderOpen, GripVertical, ListMusic, Music2, Plus, Trash2 } from 'lucide-react';
import { formatTime } from '@/lib/music';
import type { usePlayer } from '@/hooks/use-player';

type Player = ReturnType<typeof usePlayer>;
type Props = { player: Player; onOpenFiles: () => void; onOpenFolder: () => void };

export default function QueuePanel({ player: p, onOpenFiles, onOpenFolder }: Props) {
  const [tab, setTab] = useState<'queue' | 'details'>('queue');
  const [dragged, setDragged] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const onDrop = (event: DragEvent, id: number) => {
    if (!event.dataTransfer.types.includes('application/x-lumatune-track')) return;
    event.preventDefault(); event.stopPropagation();
    if (dragged !== null) p.move(dragged, id);
    setDragged(null); setOver(null);
  };
  return <aside className="queue-panel">
    <div className="queue-tabs"><button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>播放队列 <span>{p.queue.length}</span></button><button className={tab === 'details' ? 'active' : ''} onClick={() => setTab('details')}>曲目信息</button><ListMusic size={16} /></div>
    {tab === 'queue' ? <>
      <div className="queue-description"><span>{p.queue.length} 首歌曲</span><small>{p.mode === 'shuffle' ? '随机播放' : p.mode === 'repeat' ? '单曲循环' : '顺序播放'}</small></div>
      <div className="queue-list">{p.queue.map((t, i) => <div key={t.id} className={`queue-sortable ${over === t.id ? 'drop-target' : ''}`} draggable onDragStart={event => { setDragged(t.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-lumatune-track', String(t.id)); }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-lumatune-track')) { event.preventDefault(); setOver(t.id); } }} onDragLeave={() => setOver(null)} onDrop={event => onDrop(event, t.id)} onDragEnd={() => { setDragged(null); setOver(null); }}><button className={`queue-track ${p.trackId === t.id ? 'current' : ''}`} onClick={() => p.select(t.id)}><GripVertical className="queue-grip" size={13} /><span className="track-number">{p.trackId === t.id ? <AudioLines size={14} /> : String(i + 1).padStart(2, '0')}</span><img src={t.cover} alt="" /><span className="queue-track-label">{t.title}<small>{t.artist}</small></span><span className="track-duration">{formatTime(t.duration)}</span></button></div>)}</div>
      {!p.queue.length && <div className="queue-empty"><Music2 size={25} /><span>队列为空</span></div>}
      <div className="queue-actions"><button onClick={onOpenFiles}><Plus size={15} /> 打开歌曲</button><button onClick={onOpenFolder}><FolderOpen size={15} /> 打开文件夹</button>{p.queue.length > 0 && <button onClick={p.clearQueue} title="清空播放队列" aria-label="清空播放队列"><Trash2 size={15} /></button>}</div>
    </> : p.hasTrack ? <div className="inline-details"><img src={p.track.cover} alt="专辑封面" /><h3>{p.track.title}</h3><p>{p.track.artist}</p><dl>{[['专辑', p.track.album], ['风格', p.track.genre], ['发行', p.track.year], ['时长', formatTime(p.track.duration)], ['音频', p.track.source ? '本地文件' : '演示音频']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div> : <div className="queue-empty">队列为空</div>}
  </aside>;
}
