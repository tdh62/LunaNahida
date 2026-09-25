import { Heart, Info, ListMusic, Play, Search, Plus, Trash2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatTime, type Track } from '@/lib/music';
import { type Playlist } from '@/lib/playlists';

type LibraryViewProps = {
  title: string;
  tracks: Track[];
  currentId: number | null;
  liked: number[];
  onPlay: (id: number) => void;
  onToggleLike: (id: number) => void;
  onViewInfo: (track: Track) => void;
  onArtist?: (name: string) => void;
  onAlbum?: (track: Track) => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, ids: number[]) => void;
  onRemoveFromPlaylist?: (ids: number[]) => void;
};

const VIRTUAL_THRESHOLD = 200;
const INITIAL_BATCH = 200;
const NEXT_BATCH = 100;
const OVERSCAN = 8;

export default function LibraryView({ title, tracks, currentId, liked, onPlay, onToggleLike, onViewInfo, onArtist, onAlbum, playlists, onAddToPlaylist, onRemoveFromPlaylist }: LibraryViewProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [loadedCount, setLoadedCount] = useState(INITIAL_BATCH);
  const anchor = useRef<number | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const filtered = tracks.filter(track => `${track.title}${track.artist}${track.album}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = selectedIds.filter(id => filtered.some(track => track.id === id));
  const virtualized = filtered.length > VIRTUAL_THRESHOLD;
  const rowHeight = window.matchMedia('(max-width: 760px)').matches ? 66 : 72;
  const start = virtualized ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const visibleCount = virtualized ? Math.ceil((rowsRef.current?.clientHeight ?? window.innerHeight) / rowHeight) + OVERSCAN * 2 : filtered.length;
  const end = Math.min(virtualized ? loadedCount : filtered.length, start + visibleCount);
  const renderedTracks = filtered.slice(start, end);

  const onRowsScroll = () => {
    const element = rowsRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
    if (virtualized && loadedCount < filtered.length && element.scrollTop + element.clientHeight >= loadedCount * rowHeight - rowHeight * 30) {
      setLoadedCount(count => Math.min(filtered.length, count + NEXT_BATCH));
    }
  };

  const selectRow = (event: MouseEvent | KeyboardEvent, id: number) => {
    if (event.shiftKey && anchor.current !== null) {
      const from = filtered.findIndex(track => track.id === anchor.current);
      const to = filtered.findIndex(track => track.id === id);
      if (from !== -1) {
        const range = filtered.slice(Math.min(from, to), Math.max(from, to) + 1).map(track => track.id);
        setSelectedIds(event.ctrlKey || event.metaKey ? [...new Set([...selected, ...range])] : range);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) setSelectedIds(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
    else setSelectedIds([id]);
    anchor.current = id;
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: number) => {
    if (event.target !== event.currentTarget) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); setSelectedIds(filtered.map(track => track.id)); return;
    }
    if (event.key === 'Enter') { event.preventDefault(); onPlay(id); }
    if (event.key === ' ') { event.preventDefault(); selectRow(event, id); }
  };

  return <section className="library-view">
    <div className="library-heading">
      <div><span className="eyebrow"><span /> MUSIC LIBRARY</span><h1>{title}</h1><p>{tracks.length} 首歌曲{selected.length > 0 && ` · 已选 ${selected.length} 首`}</p></div>
      <div className="library-search"><Search size={17} /><input aria-label="搜索歌曲、歌手或专辑" placeholder="搜索歌曲、歌手或专辑" value={search} onChange={event => { setSearch(event.target.value); setSelectedIds([]); anchor.current = null; setScrollTop(0); setLoadedCount(INITIAL_BATCH); if (rowsRef.current) rowsRef.current.scrollTop = 0; }} /></div>
    </div>
    <div className="library-table-head"><span>歌曲</span><span>专辑</span><span>时长</span><span /></div>
    <div ref={rowsRef} onScroll={onRowsScroll} className={`library-rows ${virtualized ? 'is-virtualized' : ''}`} role="listbox" aria-label={`${title}歌曲列表`} aria-multiselectable="true">
      {virtualized && <div aria-hidden="true" style={{ height: start * rowHeight }} />}
      {renderedTracks.map(track => {
        const menuIds = selected.includes(track.id) ? selected : [track.id];
        const likeable = menuIds.filter(id => !tracks.find(item => item.id === id)?.source);
        const allLiked = likeable.every(id => liked.includes(id));
        return <ContextMenu key={track.id}><ContextMenuTrigger asChild>
          <div className={`library-row ${currentId === track.id ? 'is-current' : ''} ${selected.includes(track.id) ? 'is-selected' : ''}`} role="option" aria-selected={selected.includes(track.id)} tabIndex={0} onClick={event => selectRow(event, track.id)} onDoubleClick={() => onPlay(track.id)} onContextMenu={() => { if (!selected.includes(track.id)) { setSelectedIds([track.id]); anchor.current = track.id; } }} onKeyDown={event => onRowKeyDown(event, track.id)}>
            <span className="library-play"><img src={track.cover} alt="" /><span className="library-play-icon"><Play size={18} fill="currentColor" /></span></span>
            <span className="library-track-name"><strong>{track.title}</strong>{onArtist ? <button type="button" className="track-meta-link" onClick={event => { event.stopPropagation(); onArtist(track.artist); }} onDoubleClick={event => event.stopPropagation()}>{track.artist}</button> : <small>{track.artist}</small>}</span>
            <span className="library-album">{onAlbum ? <button type="button" className="track-meta-link" onClick={event => { event.stopPropagation(); onAlbum(track); }} onDoubleClick={event => event.stopPropagation()}>{track.album}</button> : track.album}</span><span className="library-duration">{formatTime(track.duration)}</span>
            {track.source ? <span /> : <button type="button" className={`library-like ${liked.includes(track.id) ? 'is-liked' : ''}`} onClick={event => { event.stopPropagation(); onToggleLike(track.id); }} onDoubleClick={event => event.stopPropagation()} aria-label={liked.includes(track.id) ? `取消喜欢 ${track.title}` : `喜欢 ${track.title}`} title={liked.includes(track.id) ? '取消喜欢' : '喜欢'}><Heart size={18} fill={liked.includes(track.id) ? 'currentColor' : 'none'} /></button>}
          </div>
        </ContextMenuTrigger><ContextMenuContent className="queue-context">
          <ContextMenuItem onSelect={() => onPlay(track.id)}><Play size={15} />{menuIds.length > 1 ? '播放此曲' : '立即播放'}</ContextMenuItem>
          <ContextMenuItem onSelect={() => onViewInfo(track)}><Info size={15} />{menuIds.length > 1 ? '查看此曲信息' : '查看信息'}</ContextMenuItem>
          {playlists && onAddToPlaylist && playlists.length > 0 && <ContextMenuSub><ContextMenuSubTrigger><Plus size={15} className="mr-2" />添加到歌单</ContextMenuSubTrigger><ContextMenuSubContent className="queue-context">{playlists.map(playlist => <ContextMenuItem key={playlist.id} onSelect={() => onAddToPlaylist(playlist.id, menuIds)}>{playlist.name}</ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
          {onRemoveFromPlaylist && <ContextMenuItem onSelect={() => onRemoveFromPlaylist(menuIds)}><Trash2 size={15} />从列表移除{menuIds.length > 1 && ` (${menuIds.length})`}</ContextMenuItem>}
          {likeable.length > 0 && <ContextMenuItem onSelect={() => likeable.filter(id => liked.includes(id) === allLiked).forEach(onToggleLike)}><Heart size={15} />{allLiked ? '取消喜欢' : '添加到我喜欢的'}{likeable.length > 1 && ` (${likeable.length})`}</ContextMenuItem>}
        </ContextMenuContent></ContextMenu>;
      })}
      {virtualized && <div aria-hidden="true" style={{ height: Math.max(0, (Math.min(loadedCount, filtered.length) - end) * rowHeight) }} />}
      {!filtered.length && <div className="library-empty"><ListMusic size={28} /><p>{search ? '没有找到匹配的曲目' : title === '我喜欢的' ? '还没有喜欢的歌曲' : title === '最近播放' ? '还没有播放记录' : '还没有歌曲'}</p></div>}
    </div>
  </section>;
}
