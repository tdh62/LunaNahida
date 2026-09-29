import { Check, Plus, Tag } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Track } from '@/lib/music';

type Props = {
  track: Track;
  theme: string;
  customTags: string[];
  onToggle: (id: number, name: string, add: boolean) => Promise<boolean>;
  onCreate: (id: number, name: string) => Promise<boolean>;
};

export default function TrackTagEditor({ track, theme, customTags, onToggle, onCreate }: Props) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const embedded = track.embeddedTags ?? [];
  const selected = track.customTags ?? [];
  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const existing = customTags.find(tag => tag.toLocaleLowerCase() === name.toLocaleLowerCase());
      const saved = existing ? selected.some(tag => tag.toLocaleLowerCase() === name.toLocaleLowerCase()) || await onToggle(track.id, existing, true) : await onCreate(track.id, name);
      if (saved) setNewName('');
    } finally {
      setBusy(false);
    }
  };

  return <Popover><PopoverTrigger asChild><button type="button" className="track-tag-add" aria-label="编辑这首歌的标签" title={track.temporary ? '将歌曲加入音乐库后可编辑标签' : '编辑这首歌的标签'} disabled={track.temporary}><Plus size={13} /></button></PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className={`track-tag-popover theme-${theme}`}>
      <div className="track-tag-popover-title"><Tag size={15} /><strong>歌曲标签</strong></div>
      {customTags.length > 0 && <div className="track-tag-options">{customTags.map(name => {
        const checked = selected.some(tag => tag.toLocaleLowerCase() === name.toLocaleLowerCase());
        return <button key={name} type="button" role="checkbox" aria-checked={checked} disabled={busy} onClick={async () => { setBusy(true); try { await onToggle(track.id, name, !checked); } finally { setBusy(false); } }}><span className={`track-tag-check ${checked ? 'checked' : ''}`}>{checked && <Check size={12} />}</span><span>{name}</span></button>;
      })}</div>}
      {embedded.length > 0 && <div className="track-tag-embedded"><span>音频自带</span><div>{embedded.map(name => <span key={name}>{name}</span>)}</div></div>}
      <form className="track-tag-create" onSubmit={event => { event.preventDefault(); void create(); }}><input aria-label="新标签名称" placeholder="新建并添加标签" maxLength={40} value={newName} onChange={event => setNewName(event.target.value)} /><button type="submit" title="创建并添加" aria-label="创建并添加" disabled={!newName.trim() || busy}><Plus size={16} /></button></form>
    </PopoverContent>
  </Popover>;
}
