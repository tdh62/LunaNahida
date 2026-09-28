import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Track } from '@/lib/music';
import { trackTags } from '@/lib/music';

type Props = {
  tracks: Track[];
  customTags: string[];
  onCreate: (name: string) => Promise<boolean>;
  onRename: (oldName: string, newName: string) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
  onOpen: (name: string) => void;
};

export default function TagsView({ tracks, customTags, onCreate, onRename, onDelete, onOpen }: Props) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tags = useMemo(() => {
    const byName = new Map<string, { name: string; count: number; custom: boolean; embedded: boolean }>();
    for (const name of customTags) byName.set(name.toLocaleLowerCase(), { name, count: 0, custom: true, embedded: false });
    for (const track of tracks) {
      for (const name of new Set(trackTags(track).map(tag => tag.toLocaleLowerCase()))) {
        const tag = byName.get(name) ?? { name: trackTags(track).find(item => item.toLocaleLowerCase() === name) ?? name, count: 0, custom: false, embedded: false };
        tag.count++;
        tag.embedded ||= (track.embeddedTags ?? []).some(item => item.toLocaleLowerCase() === name);
        byName.set(name, tag);
      }
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [tracks, customTags]);
  const create = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    if (await onCreate(newName.trim())) setNewName('');
    setBusy(false);
  };
  const rename = async (oldName: string) => {
    if (!editName.trim() || busy) return;
    setBusy(true);
    if (await onRename(oldName, editName.trim())) setEditing(null);
    setBusy(false);
  };
  return <section className="tags-view">
    <div className="tags-heading"><div><span className="eyebrow"><span /> MUSIC LIBRARY</span><h1>标签</h1><p>{tags.length} 个标签</p></div></div>
    <form className="tags-create" onSubmit={event => { event.preventDefault(); void create(); }}><input aria-label="新标签名称" placeholder="新标签名称" maxLength={40} value={newName} onChange={event => setNewName(event.target.value)} /><button type="submit" disabled={!newName.trim() || busy}><Plus size={16} />新建标签</button></form>
    {tags.length ? <div className="tags-list">{tags.map(tag => <div className="tags-row" key={tag.name}>
      <Tag size={18} className="tags-row-icon" />
      {editing === tag.name ? <form className="tags-edit" onSubmit={event => { event.preventDefault(); void rename(tag.name); }}><input autoFocus aria-label="重命名标签" maxLength={40} value={editName} onChange={event => setEditName(event.target.value)} /><button type="submit" title="保存" aria-label="保存" disabled={!editName.trim() || busy}><Check size={17} /></button><button type="button" title="取消" aria-label="取消" onClick={() => setEditing(null)}><X size={17} /></button></form> : <button type="button" className="tags-row-main" onClick={() => onOpen(tag.name)}><strong>{tag.name}</strong><span>{tag.count} 首歌曲 · {tag.embedded && tag.custom ? '音频 / 自定义' : tag.embedded ? '音频标签' : '自定义标签'}</span></button>}
      {tag.custom && editing !== tag.name && <div className="tags-row-actions"><button type="button" title="重命名标签" aria-label={`重命名 ${tag.name}`} onClick={() => { setEditing(tag.name); setEditName(tag.name); setDeleting(null); }}><Pencil size={16} /></button><button type="button" title="删除标签" aria-label={`删除 ${tag.name}`} onClick={() => setDeleting(tag.name)}><Trash2 size={16} /></button></div>}
      {deleting === tag.name && <div className="tags-delete"><span>删除自定义标签？</span><button type="button" disabled={busy} onClick={async () => { setBusy(true); if (await onDelete(tag.name)) setDeleting(null); setBusy(false); }}>删除</button><button type="button" onClick={() => setDeleting(null)}>取消</button></div>}
    </div>)}</div> : <div className="library-empty"><Tag size={28} /><p>还没有标签</p></div>}
  </section>;
}
