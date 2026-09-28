import { ArrowLeft, ImagePlus, ListMusic, Play, Plus, Trash2, Upload, Disc3 } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import LibraryView from '@/components/LibraryView';
import { type Track } from '@/lib/music';
import { type Playlist } from '@/lib/playlists';
import { backend } from '@/lib/backend';
import { hasTrackDrag, readTrackDrag } from '@/lib/track-drag';

type Props = {
  playlists: Playlist[];
  playlist?: Playlist;
  displayCover?: string;
  tracks: Track[];
  currentId: number | null;
  liked: number[];
  onCreate: () => void;
  onDelete: (id: string) => void;
  onPlayPlaylist: (tracks: Track[], startId?: number) => void;
  onToggleLike: (id: number) => void;
  onViewInfo: (track: Track) => void;
  onRefreshInfo: (track: Track) => void;
  onSaveLyrics: (track: Track) => void;
  onArtist: (name: string) => void;
  onAlbum: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, ids: number[]) => void;
  onRemoveFromPlaylist: (playlistId: string, ids: number[]) => void;
  onEditPlaylist: (playlist: Playlist) => void;
};

type CoverMode = 'upload' | 'first-track';

export default function PlaylistView({ playlists, playlist, displayCover, tracks, currentId, liked, onCreate, onDelete, onPlayPlaylist, onToggleLike, onViewInfo, onRefreshInfo, onSaveLyrics, onArtist, onAlbum, onAddToPlaylist, onRemoveFromPlaylist, onEditPlaylist }: Props) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverMode, setCoverMode] = useState<CoverMode>('upload');
  const [uploadedCover, setUploadedCover] = useState('');
  const [dropOverId, setDropOverId] = useState<string | null>(null);
  const playlistTracks = playlist?.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track)) ?? [];
  const firstTrackCover = playlistTracks[0]?.cover ?? '';
  const onDragOverPlaylist = (event: DragEvent, id: string) => {
    if (!hasTrackDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
    setDropOverId(id);
  };
  const onDropPlaylist = (event: DragEvent, id: string) => {
    if (!hasTrackDrag(event.dataTransfer)) return;
    event.preventDefault(); event.stopPropagation(); setDropOverId(null);
    onAddToPlaylist(id, readTrackDrag(event.dataTransfer));
  };

  const openEditor = () => {
    if (!playlist) return;
    setName(playlist.name);
    setDescription(playlist.description);
    setUploadedCover(playlist.cover.startsWith('/api/media/cover/') ? playlist.cover : '');
    setCoverMode(playlist.coverMode);
    setEditing(true);
  };

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    try { setUploadedCover(await backend.uploadCover(file)); setCoverMode('upload'); }
    catch (error) { toast.error(error instanceof Error ? error.message : '封面上传失败'); }
  };
  const savePlaylist = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!playlist || !name.trim()) return;
    if (coverMode === 'upload' && !uploadedCover) { toast.error('请先选择本地图片'); return; }
    onEditPlaylist({ ...playlist, name: name.trim(), description: description.trim(), coverMode, cover: coverMode === 'upload' ? uploadedCover : '' });
    setEditing(false);
    toast.success('歌单信息已更新');
  };

  if (!playlist) return <section className="playlists-view">
    <header className="playlists-heading"><div><span className="eyebrow"><span /> YOUR COLLECTION</span><h1>我的歌单</h1><p>{playlists.length} 个歌单 · 为不同的心情留一处角落</p></div><button type="button" className="playlist-primary" onClick={onCreate}><Plus size={16} /> 新建歌单</button></header>
    <div className="playlist-grid">{playlists.map(item => {
      const playableTracks = item.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track));
      return <div className={`playlist-card ${dropOverId === item.id ? 'track-drop-target' : ''}`} key={item.id} onDragOver={event => onDragOverPlaylist(event, item.id)} onDragLeave={event => { if (event.target === event.currentTarget) setDropOverId(null); }} onDrop={event => onDropPlaylist(event, item.id)}>
        <button type="button" className="playlist-cover" aria-label={`播放歌单 ${item.name}`} title={playableTracks.length ? `播放 ${item.name}` : '歌单为空'} disabled={!playableTracks.some(track => track.available !== false)} onClick={() => onPlayPlaylist(playableTracks)}><img src={item.cover} alt="" /><span><Play size={23} fill="currentColor" /></span></button>
        <button type="button" className="playlist-card-info" onClick={() => navigate(`/playlists/${item.id}`)}><strong>{item.name}</strong><small>{item.trackIds.length} 首歌曲</small><p>{item.description}</p></button>
      </div>;
    })}</div>
    {!playlists.length && <div className="playlist-empty"><ListMusic size={30} /><p>还没有歌单</p><button type="button" onClick={onCreate}>创建第一个歌单</button></div>}
  </section>;

  const coverPreview = coverMode === 'upload' ? uploadedCover : firstTrackCover;
  return <section className="playlist-detail">
    <button type="button" className="playlist-back" onClick={() => navigate('/playlists')}><ArrowLeft size={16} /> 返回歌单</button>
    <header className={`playlist-hero ${dropOverId === playlist.id ? 'track-drop-target' : ''}`} onDragOver={event => onDragOverPlaylist(event, playlist.id)} onDragLeave={event => { if (event.target === event.currentTarget) setDropOverId(null); }} onDrop={event => onDropPlaylist(event, playlist.id)}><button type="button" className="playlist-hero-cover" aria-label={`播放歌单 ${playlist.name}`} disabled={!playlistTracks.some(track => track.available !== false)} onClick={() => onPlayPlaylist(playlistTracks)}><img src={displayCover} alt="" /><span><Play size={25} fill="currentColor" /></span></button><div><span className="eyebrow"><span /> PLAYLIST</span><h1>{playlist.name}</h1><p>{playlist.description}</p><small>{playlistTracks.length} 首歌曲</small><div className="playlist-hero-actions"><button type="button" className="playlist-primary" disabled={!playlistTracks.some(track => track.available !== false)} onClick={() => onPlayPlaylist(playlistTracks)}><Play size={16} fill="currentColor" /> 播放</button><button type="button" className="playlist-edit" title="编辑歌单" aria-label="编辑歌单" onClick={openEditor}><ImagePlus size={17} /></button><button type="button" className="playlist-delete" title="删除歌单" aria-label={`删除歌单 ${playlist.name}`} onClick={() => onDelete(playlist.id)}><Trash2 size={17} /></button></div></div></header>
    {playlistTracks.length === 0 ? <div className="playlist-empty"><ListMusic size={30} /><p>这个歌单还没有歌曲</p><button type="button" onClick={() => navigate('/music')}>前往音乐库添加歌曲</button></div> : <LibraryView key={playlist.id} title="歌曲列表" tracks={playlistTracks} currentId={currentId} liked={liked} onPlay={id => onPlayPlaylist(playlistTracks, id)} onPlayMany={onPlayPlaylist} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onRefreshInfo={onRefreshInfo} onSaveLyrics={onSaveLyrics} onArtist={onArtist} onAlbum={onAlbum} playlists={playlists} onAddToPlaylist={onAddToPlaylist} onRemoveFromPlaylist={ids => onRemoveFromPlaylist(playlist.id, ids)} />}
    {editing && <div className="playlist-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><section className="playlist-editor" role="dialog" aria-modal="true" aria-labelledby="playlist-editor-title"><header><div><span className="eyebrow"><span /> PLAYLIST SETTINGS</span><h2 id="playlist-editor-title">编辑歌单</h2></div><button type="button" aria-label="关闭编辑" onClick={() => setEditing(false)}>×</button></header><form onSubmit={savePlaylist}>
      <label className="playlist-field">歌单名称<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="歌单名称" /></label>
      <label className="playlist-field">简介<textarea maxLength={120} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="写一句关于这个歌单的话" /></label>
      <fieldset className="cover-picker"><legend>封面图片</legend><div className="cover-mode-tabs">{([['upload', '本地图片', Upload], ['first-track', '首曲专辑图', Disc3]] as const).map(([mode, label, Icon]) => <button type="button" key={mode} className={coverMode === mode ? 'active' : ''} onClick={() => setCoverMode(mode)}><Icon size={14} /><span>{label}</span></button>)}</div>
      {coverMode === 'upload' && <div className="cover-upload"><button type="button" onClick={() => fileInput.current?.click()}><Upload size={16} />{uploadedCover ? '更换本地图片' : '选择本地图片'}</button><input ref={fileInput} type="file" accept="image/*" hidden onChange={event => chooseFile(event.target.files?.[0])} />{uploadedCover && <small>已选择本地图片</small>}</div>}
      {coverMode === 'first-track' && <p className="cover-hint">{firstTrackCover ? `使用《${playlistTracks[0].title}》的专辑封面` : '歌单为空，请先添加歌曲'}</p>}
      <div className="cover-preview"><span>封面预览</span><img src={coverPreview || '/covers/local.svg'} alt="封面预览" /></div>
      </fieldset><footer><button type="button" className="editor-cancel" onClick={() => setEditing(false)}>取消</button><button type="submit" className="playlist-primary">保存修改</button></footer>
    </form></section></div>}
  </section>;
}
