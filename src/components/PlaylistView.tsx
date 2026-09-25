import { ArrowLeft, ImagePlus, Link2, ListMusic, Play, Plus, Trash2, Upload, Disc3, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
  onArtist: (name: string) => void;
  onAlbum: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, ids: number[]) => void;
  onRemoveFromPlaylist: (playlistId: string, ids: number[]) => void;
  onEditPlaylist: (playlist: Playlist) => void;
};

const presetCovers = [
  'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1472120435266-53107fd0c44a?w=800&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&auto=format&fit=crop&q=85',
];

type CoverMode = 'upload' | 'url' | 'preset' | 'first-track';

export default function PlaylistView({ playlists, playlist, tracks, currentId, liked, onCreate, onDelete, onPlay, onToggleLike, onViewInfo, onArtist, onAlbum, onAddToPlaylist, onRemoveFromPlaylist, onEditPlaylist }: Props) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverMode, setCoverMode] = useState<CoverMode>('preset');
  const [coverUrl, setCoverUrl] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(presetCovers[0]);
  const [uploadedCover, setUploadedCover] = useState('');
  const playlistTracks = playlist?.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track)) ?? [];
  const firstTrackCover = playlistTracks[0]?.cover ?? '';

  useEffect(() => {
    if (!playlist || !editing) return;
    setName(playlist.name);
    setDescription(playlist.description);
    setCoverUrl(playlist.cover.startsWith('http') ? playlist.cover : '');
    setSelectedPreset(presetCovers.includes(playlist.cover) ? playlist.cover : presetCovers[0]);
    setUploadedCover(playlist.cover.startsWith('data:image/') ? playlist.cover : '');
    setCoverMode(playlist.cover.startsWith('data:image/') ? 'upload' : playlist.cover.startsWith('http') && !presetCovers.includes(playlist.cover) ? 'url' : 'preset');
  }, [playlist, editing]);

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('请选择图片文件'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') { setUploadedCover(reader.result); setCoverMode('upload'); }
    };
    reader.readAsDataURL(file);
  };
  const savePlaylist = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!playlist || !name.trim()) return;
    let cover = playlist.cover;
    if (coverMode === 'upload') {
      if (!uploadedCover) { toast.error('请先选择本地图片'); return; }
      cover = uploadedCover;
    } else if (coverMode === 'url') {
      if (!/^https?:\/\//i.test(coverUrl.trim())) { toast.error('请输入有效的图片链接'); return; }
      cover = coverUrl.trim();
    } else if (coverMode === 'preset') cover = selectedPreset;
    else {
      if (!firstTrackCover) { toast.error('歌单中还没有歌曲，无法使用专辑图'); return; }
      cover = firstTrackCover;
    }
    onEditPlaylist({ ...playlist, name: name.trim(), description: description.trim(), cover });
    setEditing(false);
    toast.success('歌单信息已更新');
  };

  if (!playlist) return <section className="playlists-view">
    <header className="playlists-heading"><div><span className="eyebrow"><span /> YOUR COLLECTION</span><h1>我的歌单</h1><p>{playlists.length} 个歌单 · 为不同的心情留一处角落</p></div><button type="button" className="playlist-primary" onClick={onCreate}><Plus size={16} /> 新建歌单</button></header>
    <div className="playlist-grid">{playlists.map(item => <button type="button" className="playlist-card" key={item.id} onClick={() => navigate(`/playlists/${item.id}`)}><span className="playlist-cover"><img src={item.cover} alt="" /><span><Play size={23} fill="currentColor" /></span></span><strong>{item.name}</strong><small>{item.trackIds.length} 首歌曲</small><p>{item.description}</p></button>)}</div>
    {!playlists.length && <div className="playlist-empty"><ListMusic size={30} /><p>还没有歌单</p><button type="button" onClick={onCreate}>创建第一个歌单</button></div>}
  </section>;

  const coverPreview = coverMode === 'upload' ? uploadedCover : coverMode === 'url' ? coverUrl : coverMode === 'first-track' ? firstTrackCover : selectedPreset;
  return <section className="playlist-detail">
    <button type="button" className="playlist-back" onClick={() => navigate('/playlists')}><ArrowLeft size={16} /> 返回歌单</button>
    <header className="playlist-hero"><img src={playlist.cover} alt="" /><div><span className="eyebrow"><span /> PLAYLIST</span><h1>{playlist.name}</h1><p>{playlist.description}</p><small>{playlistTracks.length} 首歌曲</small><div className="playlist-hero-actions"><button type="button" className="playlist-primary" disabled={!playlistTracks.length} onClick={() => onPlay(playlistTracks[0].id)}><Play size={16} fill="currentColor" /> 播放</button><button type="button" className="playlist-edit" title="编辑歌单" aria-label="编辑歌单" onClick={() => setEditing(true)}><ImagePlus size={17} /></button><button type="button" className="playlist-delete" title="删除歌单" aria-label={`删除歌单 ${playlist.name}`} onClick={() => onDelete(playlist.id)}><Trash2 size={17} /></button></div></div></header>
    {playlistTracks.length === 0 ? <div className="playlist-empty"><ListMusic size={30} /><p>这个歌单还没有歌曲</p><button type="button" onClick={() => navigate('/music')}>前往音乐库添加歌曲</button></div> : <LibraryView key={playlist.id} title="歌曲列表" tracks={playlistTracks} currentId={currentId} liked={liked} onPlay={onPlay} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onArtist={onArtist} onAlbum={onAlbum} playlists={playlists} onAddToPlaylist={onAddToPlaylist} onRemoveFromPlaylist={ids => onRemoveFromPlaylist(playlist.id, ids)} />}
    {editing && <div className="playlist-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><section className="playlist-editor" role="dialog" aria-modal="true" aria-labelledby="playlist-editor-title"><header><div><span className="eyebrow"><span /> PLAYLIST SETTINGS</span><h2 id="playlist-editor-title">编辑歌单</h2></div><button type="button" aria-label="关闭编辑" onClick={() => setEditing(false)}>×</button></header><form onSubmit={savePlaylist}>
      <label className="playlist-field">歌单名称<input required maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="歌单名称" /></label>
      <label className="playlist-field">简介<textarea maxLength={120} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="写一句关于这个歌单的话" /></label>
      <fieldset className="cover-picker"><legend>封面图片</legend><div className="cover-mode-tabs">{([['upload', '本地图片', Upload], ['url', '图片链接', Link2], ['preset', '预置图片', ImagePlus], ['first-track', '首曲专辑图', Disc3]] as const).map(([mode, label, Icon]) => <button type="button" key={mode} className={coverMode === mode ? 'active' : ''} onClick={() => setCoverMode(mode)}><Icon size={14} /><span>{label}</span></button>)}</div>
      {coverMode === 'upload' && <div className="cover-upload"><button type="button" onClick={() => fileInput.current?.click()}><Upload size={16} />{uploadedCover ? '更换本地图片' : '选择本地图片'}</button><input ref={fileInput} type="file" accept="image/*" hidden onChange={event => chooseFile(event.target.files?.[0])} />{uploadedCover && <small>已选择本地图片</small>}</div>}
      {coverMode === 'url' && <label className="playlist-field cover-url-field">图片地址<input type="url" value={coverUrl} onChange={event => setCoverUrl(event.target.value)} placeholder="https://example.com/cover.jpg" /></label>}
      {coverMode === 'preset' && <div className="cover-presets">{presetCovers.map((cover, index) => <button type="button" key={cover} aria-label={`预置封面 ${index + 1}`} aria-pressed={selectedPreset === cover} className={selectedPreset === cover ? 'selected' : ''} onClick={() => setSelectedPreset(cover)}><img src={cover} alt="" />{selectedPreset === cover && <Check size={18} />}</button>)}</div>}
      {coverMode === 'first-track' && <p className="cover-hint">{firstTrackCover ? `使用《${playlistTracks[0].title}》的专辑封面` : '歌单为空，请先添加歌曲'}</p>}
      <div className="cover-preview"><span>封面预览</span><img src={coverPreview || '/covers/local.svg'} alt="封面预览" /></div>
      </fieldset><footer><button type="button" className="editor-cancel" onClick={() => setEditing(false)}>取消</button><button type="submit" className="playlist-primary">保存修改</button></footer>
    </form></section></div>}
  </section>;
}
