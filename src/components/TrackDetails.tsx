import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { backend } from '@/lib/backend';
import { formatTime, trackTags, type Track } from '@/lib/music';
import { isBrowserTrack } from '@/lib/browser-tracks';
import { useRuntime } from '@/hooks/use-runtime';
import '@/track-details.css';

type Props = {
  track: Track;
  theme: string;
  onClose: () => void;
  onSaved: (track: Track) => void;
  onArtist: (name: string) => void;
  onAlbum: (track: Track) => void;
  onTag: (name: string) => void;
};

export default function TrackDetails({ track, theme, onClose, onSaved, onArtist, onAlbum, onTag }: Props) {
  const runtime = useRuntime();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const updated = isBrowserTrack(track)
        ? { ...track, title: title.trim(), artist: artist.trim(), album: album.trim() }
        : await backend.updateTrackMetadata(track.id, title.trim(), artist.trim(), album.trim());
      onSaved(updated);
      setEditing(false);
      toast.success(track.temporary ? '本次播放的信息已更新' : '歌曲信息已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '歌曲信息保存失败');
    } finally {
      setSaving(false);
    }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className={`music-dialog theme-${theme}`}><DialogTitle>关于这首歌</DialogTitle><DialogDescription>{track.temporary ? '本次播放' : '音频信息'}</DialogDescription>
    <div className={`detail-modal ${editing ? 'is-editing' : ''}`}><img src={track.cover} alt={`${track.album}封面`} /><div>
      {editing ? <form className="track-details-form" onSubmit={event => void save(event)}>
        <label>名称<input autoFocus required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>歌手<input required maxLength={120} value={artist} onChange={event => setArtist(event.target.value)} /></label>
        <label>专辑<input required maxLength={120} value={album} onChange={event => setAlbum(event.target.value)} /></label>
        <div className="track-details-actions"><button type="button" className="editor-cancel" disabled={saving} onClick={() => setEditing(false)}>取消</button><button type="submit" className="playlist-primary" disabled={saving || !title.trim() || !artist.trim() || !album.trim()}>保存修改</button></div>
      </form> : <><div className="track-details-heading"><span className="eyebrow">LOCAL AUDIO</span><button type="button" className="track-details-edit" title="编辑歌曲信息" onClick={() => setEditing(true)}><Pencil size={16} />编辑信息</button></div><h2>{track.title}</h2><p><button type="button" className="track-meta-link" disabled={!runtime.backend} onClick={() => onArtist(track.artist)}>{track.artist}</button></p><dl><dt>专辑</dt><dd><button type="button" className="track-meta-link" disabled={!runtime.backend} onClick={() => onAlbum(track)}>{track.album}</button></dd><dt>标签</dt><dd>{trackTags(track).length ? <span className="detail-tags">{trackTags(track).map(name => <button type="button" key={name} onClick={() => onTag(name)}>{name}</button>)}</span> : '未标注'}</dd><dt>音乐风格</dt><dd>{track.genre || '未标注'}</dd><dt>发行年份</dt><dd>{track.year || '未知'}</dd><dt>时长</dt><dd>{formatTime(track.duration)}</dd><dt>{isBrowserTrack(track) ? '文件' : '路径'}</dt><dd>{track.path || track.fileName}</dd></dl></>}
    </div></div>
  </DialogContent></Dialog>;
}
