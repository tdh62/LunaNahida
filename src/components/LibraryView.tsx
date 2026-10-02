import { Heart, Info, ListMusic, Play, RefreshCw, Save, Search, Shuffle, Plus, Trash2, Tag } from 'lucide-react';
import { useMemo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import LocateCurrentTrackButton from '@/components/LocateCurrentTrackButton';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatTime, trackTags, type Track } from '@/lib/music';
import { type Playlist } from '@/lib/playlists';
import { writeTrackDrag } from '@/lib/track-drag';
import { getVirtualTrackLocation, getVirtualTrackRange, locateCurrentTrack } from '@/lib/track-location';

type LibraryViewProps = {
  title: string;
  tracks: Track[];
  currentId: number | null;
  liked: number[];
  onPlay: (id: number) => void;
  onPlayMany: (tracks: Track[]) => void;
  onShufflePlay?: (tracks: Track[]) => void;
  onToggleLike: (id: number) => void;
  onViewInfo: (track: Track) => void;
  onRefreshInfo?: (track: Track) => void;
  onSaveLyrics?: (track: Track) => void;
  onArtist?: (name: string) => void;
  onAlbum?: (track: Track) => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: string, ids: number[]) => void;
  onRemoveFromPlaylist?: (ids: number[]) => void;
  onDeleteTracks?: (ids: number[]) => void;
  customTags?: string[];
  allTagNames?: string[];
  selectedTag?: string;
  onTagFilter?: (name: string) => void;
  onSetTrackTag?: (ids: number[], name: string, add: boolean) => void;
};

import TrackFilterControls from './TrackFilterControls';
import { queryTracks, type TrackConditions, type TrackSort } from '@/lib/track-query';

const VIRTUAL_THRESHOLD = 200;
const OVERSCAN = 8;

export default function LibraryView({ title, tracks, currentId, liked, onPlay, onPlayMany, onShufflePlay, onToggleLike, onViewInfo, onRefreshInfo, onSaveLyrics, onArtist, onAlbum, playlists, onAddToPlaylist, onRemoveFromPlaylist, onDeleteTracks, customTags, allTagNames, selectedTag = '', onTagFilter, onSetTrackTag }: LibraryViewProps) {
  const [search, setSearch] = useState('');
  const [conditions, setConditions] = useState<TrackConditions>({});
  const [sort, setSort] = useState<TrackSort>('original');
  const [descending, setDescending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(() => ({ height: window.innerHeight, rowHeight: window.matchMedia('(max-width: 760px)').matches ? 66 : 72 }));
  const anchor = useRef<number | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [locateRequest, setLocateRequest] = useState<{ id: number; scrollTop: number } | null>(null);
  const filtered = useMemo(() => queryTracks(tracks, {...conditions, keyword: search}, liked, sort, descending).filter(track => !selectedTag || trackTags(track).some(tag => tag.toLocaleLowerCase() === selectedTag.toLocaleLowerCase())), [tracks, conditions, search, liked, sort, descending, selectedTag]);
  useEffect(() => { setSelectedIds([]); anchor.current = null; setScrollTop(0); if (rowsRef.current) rowsRef.current.scrollTop = 0; }, [conditions, sort, descending]);
  const selected = selectedIds.filter(id => filtered.some(track => track.id === id));
  const selectedDeletable = selected.length > 0 && selected.every(id => tracks.find(track => track.id === id)?.deletable);
  const virtualized = filtered.length > VIRTUAL_THRESHOLD;
  const { rowHeight } = viewport;
  const range = getVirtualTrackRange(filtered.length, rowHeight, viewport.height, scrollTop, OVERSCAN);
  const start = virtualized ? range.start : 0;
  const end = virtualized ? range.end : filtered.length;
  const renderedTracks = filtered.slice(start, end);
  const currentIndex = filtered.findIndex(track => track.id === currentId);

  const onLocate = () => {
    const list = rowsRef.current;
    if (!list || currentId === null || currentIndex < 0) return;
    if (!virtualized) { locateCurrentTrack(list); return; }
    const currentRowHeight = window.matchMedia('(max-width: 760px)').matches ? 66 : 72;
    const location = getVirtualTrackLocation(currentIndex, filtered.length, currentRowHeight, list.clientHeight);
    if (!location) return;
    setScrollTop(location.scrollTop);
    setLocateRequest({ id: currentId, scrollTop: location.scrollTop });
  };

  useLayoutEffect(() => {
    const list = rowsRef.current;
    if (!list) return;
    const measure = () => {
      const height = list.clientHeight;
      const nextRowHeight = window.matchMedia('(max-width: 760px)').matches ? 66 : 72;
      setViewport(previous => previous.height === height && previous.rowHeight === nextRowHeight ? previous : { height, rowHeight: nextRowHeight });
      setScrollTop(list.scrollTop);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (rowsRef.current) setScrollTop(rowsRef.current.scrollTop);
  }, [filtered.length, rowHeight]);

  useLayoutEffect(() => {
    if (!locateRequest) return;
    const list = rowsRef.current;
    if (list && locateRequest.id === currentId) {
      list.scrollTop = locateRequest.scrollTop;
      locateCurrentTrack(list);
      setScrollTop(list.scrollTop);
    }
    setLocateRequest(null);
  }, [locateRequest, currentId]);

  useEffect(() => {
    const selectAll = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a' || !filtered.length) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setSelectedIds(filtered.map(track => track.id));
    };
    document.addEventListener('keydown', selectAll);
    return () => document.removeEventListener('keydown', selectAll);
  });

  const onRowsScroll = () => {
    const element = rowsRef.current;
    if (!element) return;
    setScrollTop(element.scrollTop);
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
    if (event.key === 'Delete' && onDeleteTracks && selectedDeletable) { event.preventDefault(); onDeleteTracks(selected.includes(id) ? selected : [id]); }
  };

  return <section className="library-view">
    <div className="library-heading">
      <div><span className="eyebrow"><span /> MUSIC LIBRARY</span><h1>{title}</h1><p>{filtered.length} 首歌曲{selected.length > 0 && ` · 已选 ${selected.length} 首`}</p></div>
      <div className="library-filters"><LocateCurrentTrackButton available={currentIndex >= 0} onLocate={onLocate} />{onShufflePlay && <button type="button" className="library-shuffle-play" disabled={!filtered.some(track => track.available !== false && track.playbackStatus !== 'unplayable')} onClick={() => onShufflePlay(filtered)}><Shuffle size={16} />随机播放</button>}{onDeleteTracks && selected.length > 0 && <button type="button" className="library-delete-selection" disabled={!selectedDeletable} title={selectedDeletable ? '从曲库移除所选歌曲' : '文件夹或监听路径下的歌曲不支持单独删除'} onClick={() => onDeleteTracks(selected)}><Trash2 size={16} />移除所选 ({selected.length})</button>}{allTagNames && <label className="library-tag-filter"><Tag size={16} /><select aria-label="按标签筛选" value={selectedTag} onChange={event => { onTagFilter?.(event.target.value); setSelectedIds([]); setScrollTop(0); if (rowsRef.current) rowsRef.current.scrollTop = 0; }}><option value="">全部标签</option>{allTagNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}<div className="library-search"><Search size={17} /><input aria-label="搜索歌曲、歌手、专辑或标签" placeholder="搜索歌曲、歌手、专辑或标签" value={search} onChange={event => { setSearch(event.target.value); setSelectedIds([]); anchor.current = null; setScrollTop(0); if (rowsRef.current) rowsRef.current.scrollTop = 0; }} /></div></div>
    </div>
    <div className="library-query-bar"><label>排序<select aria-label="歌曲排序" value={sort} onChange={event => setSort(event.target.value as TrackSort)}>{[['original','原有顺序'],['title','歌曲名称'],['artist','歌手'],['album','专辑'],['duration','时长'],['year','年份'],['added','加入时间']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" disabled={sort === 'original'} aria-pressed={descending} onClick={() => setDescending(!descending)}>{descending ? '降序' : '升序'}</button><button type="button" onClick={() => onPlayMany(filtered)} disabled={!filtered.some(track => track.available !== false && track.playbackStatus !== 'unplayable')}>播放筛选结果</button></div>
    <details className="library-combined-filters"><summary>组合筛选</summary><TrackFilterControls value={conditions} onChange={setConditions} /><button type="button" onClick={() => {setConditions({}); setSearch(''); onTagFilter?.('');}}>清除筛选</button></details>
    <div className="library-table-head"><span>歌曲</span><span>专辑</span><span>时长</span><span /></div>
    <div ref={rowsRef} onScroll={onRowsScroll} className={`library-rows ${virtualized ? 'is-virtualized' : ''}`} role="listbox" aria-label={`${title}歌曲列表`} aria-multiselectable="true">
      {virtualized && <div aria-hidden="true" style={{ height: range.topHeight }} />}
      {renderedTracks.map(track => {
        const menuIds = selected.includes(track.id) ? selected : [track.id];
        const menuTracks = filtered.filter(item => menuIds.includes(item.id) && item.available !== false && item.playbackStatus !== 'unplayable');
        const menuDeletable = menuIds.every(id => tracks.find(item => item.id === id)?.deletable);
        const likeable = menuIds.filter(id => tracks.some(item => item.id === id && !item.temporary));
        const removableTags = [...new Set(menuIds.flatMap(id => tracks.find(item => item.id === id)?.customTags ?? []))];
        const allLiked = likeable.every(id => liked.includes(id));
        return <ContextMenu key={track.id}><ContextMenuTrigger asChild>
          <div className={`library-row ${currentId === track.id ? 'is-current' : ''} ${selected.includes(track.id) ? 'is-selected' : ''} ${track.available === false || track.playbackStatus === 'unplayable' ? 'is-missing' : ''}`} role="option" aria-selected={selected.includes(track.id)} tabIndex={0} draggable={track.id > 0 && !track.temporary} onDragStart={event => writeTrackDrag(event.dataTransfer, selected.includes(track.id) ? selected : [track.id])} onClick={event => selectRow(event, track.id)} onDoubleClick={() => { if (track.available !== false && track.playbackStatus !== 'unplayable') onPlay(track.id); }} onContextMenu={() => { if (!selected.includes(track.id)) { setSelectedIds([track.id]); anchor.current = track.id; } }} onKeyDown={event => onRowKeyDown(event, track.id)}>
            <button type="button" className="library-play" aria-label={`播放 ${track.title}`} title={track.available === false ? '文件暂不可用' : track.playbackStatus === 'unplayable' ? '无法播放' : '播放'} disabled={track.available === false || track.playbackStatus === 'unplayable'} onClick={event => { event.stopPropagation(); onPlay(track.id); }} onDoubleClick={event => event.stopPropagation()}><img src={track.cover} alt="" /><span className="library-play-icon"><Play size={18} fill="currentColor" /></span></button>
            <span className="library-track-name"><strong>{track.title}</strong>{track.available === false ? <small>文件暂不可用</small> : track.playbackStatus === 'unplayable' ? <small>无法播放</small> : null}{onArtist ? <button type="button" className="track-meta-link" onClick={event => { event.stopPropagation(); onArtist(track.artist); }} onDoubleClick={event => event.stopPropagation()}>{track.artist}</button> : <small>{track.artist}</small>}</span>
            <span className="library-album">{onAlbum ? <button type="button" className="track-meta-link" onClick={event => { event.stopPropagation(); onAlbum(track); }} onDoubleClick={event => event.stopPropagation()}>{track.album}</button> : track.album}</span><span className="library-duration">{formatTime(track.duration)}</span>
            <button type="button" className={`library-like ${liked.includes(track.id) ? 'is-liked' : ''}`} onClick={event => { event.stopPropagation(); onToggleLike(track.id); }} onDoubleClick={event => event.stopPropagation()} aria-label={liked.includes(track.id) ? `取消喜欢 ${track.title}` : `喜欢 ${track.title}`} title={liked.includes(track.id) ? '取消喜欢' : '喜欢'}><Heart size={18} fill={liked.includes(track.id) ? 'currentColor' : 'none'} /></button>
          </div>
        </ContextMenuTrigger><ContextMenuContent className="queue-context">
          {menuTracks.length > 0 && <ContextMenuItem onSelect={() => menuIds.length > 1 ? onPlayMany(menuTracks) : onPlay(track.id)}><Play size={15} />{menuIds.length > 1 ? `播放所选 (${menuTracks.length})` : '立即播放'}</ContextMenuItem>}
          <ContextMenuItem onSelect={() => onViewInfo(track)}><Info size={15} />{menuIds.length > 1 ? '查看此曲信息' : '查看信息'}</ContextMenuItem>
          {track.source && onRefreshInfo && <ContextMenuItem onSelect={() => onRefreshInfo(track)}><RefreshCw size={15} />立即刷新信息</ContextMenuItem>}
          {onSaveLyrics && track.path && track.lyrics?.trim() && !track.localLyrics && track.available !== false && <ContextMenuItem onSelect={() => onSaveLyrics(track)}><Save size={15} />{menuIds.length > 1 ? '保存此曲歌词' : '保存歌词'}</ContextMenuItem>}
          {playlists && onAddToPlaylist && playlists.length > 0 && <ContextMenuSub><ContextMenuSubTrigger><Plus size={15} className="mr-2" />添加到歌单</ContextMenuSubTrigger><ContextMenuSubContent className="queue-context">{playlists.filter(playlist => !playlist.rules).map(playlist => <ContextMenuItem key={playlist.id} onSelect={() => onAddToPlaylist(playlist.id, menuIds)}>{playlist.name}</ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
          {customTags && onSetTrackTag && customTags.length > 0 && <ContextMenuSub><ContextMenuSubTrigger><Tag size={15} className="mr-2" />添加标签</ContextMenuSubTrigger><ContextMenuSubContent className="queue-context">{customTags.map(name => <ContextMenuItem key={name} onSelect={() => onSetTrackTag(menuIds, name, true)}>{name}</ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
          {customTags && onSetTrackTag && removableTags.length > 0 && <ContextMenuSub><ContextMenuSubTrigger><Tag size={15} className="mr-2" />移除标签</ContextMenuSubTrigger><ContextMenuSubContent className="queue-context">{removableTags.map(name => <ContextMenuItem key={name} onSelect={() => onSetTrackTag(menuIds, name, false)}>{name}</ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
          {onRemoveFromPlaylist && <ContextMenuItem onSelect={() => onRemoveFromPlaylist(menuIds)}><Trash2 size={15} />从列表移除{menuIds.length > 1 && ` (${menuIds.length})`}</ContextMenuItem>}
          {onDeleteTracks && <ContextMenuItem disabled={!menuDeletable} title={menuDeletable ? undefined : '文件夹或监听路径下的歌曲不支持单独删除'} onSelect={() => onDeleteTracks(menuIds)}><Trash2 size={15} />从曲库移除{menuIds.length > 1 && ` (${menuIds.length})`}</ContextMenuItem>}
          {likeable.length > 0 && <ContextMenuItem onSelect={() => likeable.filter(id => liked.includes(id) === allLiked).forEach(onToggleLike)}><Heart size={15} />{allLiked ? '取消喜欢' : '添加到我喜欢的'}{likeable.length > 1 && ` (${likeable.length})`}</ContextMenuItem>}
        </ContextMenuContent></ContextMenu>;
      })}
      {virtualized && <div aria-hidden="true" style={{ height: range.bottomHeight }} />}
      {!filtered.length && <div className="library-empty"><ListMusic size={28} /><p>{search || selectedTag ? '没有找到匹配的曲目' : title === '我喜欢的' ? '还没有喜欢的歌曲' : title === '最近播放' ? '还没有播放记录' : '还没有歌曲'}</p></div>}
    </div>
  </section>;
}
