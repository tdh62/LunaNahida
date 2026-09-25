import { ArrowLeft, ListMusic, Play, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import LibraryView from '@/components/LibraryView';
import { type Track } from '@/lib/music';
import { type Playlist } from '@/lib/playlists';

type Props = {
  playlists: Playlist[];
  playlist?: Playlist;
  tracks: Track[];
  currentId: number | null;
  liked: number[];
  onCreate: () => void;
  onDelete: (id: string) => void;
  onPlay: (id: number) => void;
  onToggleLike: (id: number) => void;
  onViewInfo: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, ids: number[]) => void;
  onRemoveFromPlaylist: (playlistId: string, ids: number[]) => void;
};

export default function PlaylistView({ playlists, playlist, tracks, currentId, liked, onCreate, onDelete, onPlay, onToggleLike, onViewInfo, onAddToPlaylist, onRemoveFromPlaylist }: Props) {
  const navigate = useNavigate();
  if (!playlist) return <section className="playlists-view">
    <header className="playlists-heading"><div><span className="eyebrow"><span /> YOUR COLLECTION</span><h1>我的歌单</h1><p>{playlists.length} 个歌单 · 为不同的心情留一处角落</p></div><button type="button" className="playlist-primary" onClick={onCreate}><Plus size={16} /> 新建歌单</button></header>
    <div className="playlist-grid">{playlists.map(item => <button type="button" className="playlist-card" key={item.id} onClick={() => navigate(`/playlists/${item.id}`)}><span className="playlist-cover"><img src={item.cover} alt="" /><span><Play size={23} fill="currentColor" /></span></span><strong>{item.name}</strong><small>{item.trackIds.length} 首歌曲</small><p>{item.description}</p></button>)}</div>
    {!playlists.length && <div className="playlist-empty"><ListMusic size={30} /><p>还没有歌单</p><button type="button" onClick={onCreate}>创建第一个歌单</button></div>}
  </section>;

  const playlistTracks = playlist.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track));
  return <section className="playlist-detail">
    <button type="button" className="playlist-back" onClick={() => navigate('/playlists')}><ArrowLeft size={16} /> 返回歌单</button>
    <header className="playlist-hero"><img src={playlist.cover} alt="" /><div><span className="eyebrow"><span /> PLAYLIST</span><h1>{playlist.name}</h1><p>{playlist.description}</p><small>{playlistTracks.length} 首歌曲</small><div className="playlist-hero-actions"><button type="button" className="playlist-primary" disabled={!playlistTracks.length} onClick={() => onPlay(playlistTracks[0].id)}><Play size={16} fill="currentColor" /> 播放</button><button type="button" className="playlist-delete" title="删除歌单" aria-label={`删除歌单 ${playlist.name}`} onClick={() => onDelete(playlist.id)}><Trash2 size={17} /></button></div></div></header>
    {playlistTracks.length === 0 ? <div className="playlist-empty"><ListMusic size={30} /><p>这个歌单还没有歌曲</p><button type="button" onClick={() => navigate('/music')}>前往音乐库添加歌曲</button></div> : <LibraryView key={playlist.id} title="歌曲列表" tracks={playlistTracks} currentId={currentId} liked={liked} onPlay={onPlay} onToggleLike={onToggleLike} onViewInfo={onViewInfo} playlists={playlists} onAddToPlaylist={onAddToPlaylist} onRemoveFromPlaylist={ids => onRemoveFromPlaylist(playlist.id, ids)} />}
  </section>;
}
