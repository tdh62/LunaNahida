import { Heart, ListMusic, Play, Search } from 'lucide-react';
import { useState } from 'react';
import { formatTime, type Track } from '@/lib/music';

type LibraryViewProps = {
  title: string;
  tracks: Track[];
  currentId: number | null;
  liked: number[];
  onPlay: (id: number) => void;
  onToggleLike: (id: number) => void;
};

export default function LibraryView({ title, tracks, currentId, liked, onPlay, onToggleLike }: LibraryViewProps) {
  const [search, setSearch] = useState('');
  const filtered = tracks.filter(track => `${track.title}${track.artist}${track.album}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <section className="library-view">
    <div className="library-heading">
      <div><span className="eyebrow"><span /> MUSIC LIBRARY</span><h1>{title}</h1><p>{tracks.length} 首歌曲</p></div>
      <div className="library-search"><Search size={17} /><input aria-label="搜索歌曲、歌手或专辑" placeholder="搜索歌曲、歌手或专辑" value={search} onChange={event => setSearch(event.target.value)} /></div>
    </div>
    <div className="library-table-head"><span>歌曲</span><span>专辑</span><span>时长</span><span /></div>
    <div className="library-rows">{filtered.map(track => <div className={`library-row ${currentId === track.id ? 'is-current' : ''}`} key={track.id}>
      <button className="library-play" onClick={() => onPlay(track.id)} aria-label={`播放 ${track.title}`} title={`播放 ${track.title}`}><img src={track.cover} alt="" /><span className="library-play-icon"><Play size={18} fill="currentColor" /></span></button>
      <button className="library-track-name" onClick={() => onPlay(track.id)}><strong>{track.title}</strong><small>{track.artist}</small></button>
      <span className="library-album">{track.album}</span><span className="library-duration">{formatTime(track.duration)}</span>
      {track.source ? <span /> : <button className={`library-like ${liked.includes(track.id) ? 'is-liked' : ''}`} onClick={() => onToggleLike(track.id)} aria-label={liked.includes(track.id) ? `取消喜欢 ${track.title}` : `喜欢 ${track.title}`} title={liked.includes(track.id) ? '取消喜欢' : '喜欢'}><Heart size={18} fill={liked.includes(track.id) ? 'currentColor' : 'none'} /></button>}
    </div>)}
    {!filtered.length && <div className="library-empty"><ListMusic size={28} /><p>{search ? '没有找到匹配的曲目' : title === '我喜欢的' ? '还没有喜欢的歌曲' : title === '最近播放' ? '还没有播放记录' : '还没有歌曲'}</p></div>}
    </div>
  </section>;
}
