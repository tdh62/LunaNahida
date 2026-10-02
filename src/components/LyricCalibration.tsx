import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export default function LyricCalibration({ offset, persistent, onChange }: { offset: number; persistent: boolean; onChange: (value: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(String(offset));
  useEffect(() => setDraft(String(offset)), [offset]);
  const save = async (value: number) => {
    if (busy || !Number.isFinite(value)) return;
    const next = Math.max(-60000, Math.min(60000, Math.round(value)));
    if (next === offset) { setDraft(String(next)); return; }
    setBusy(true);
    try { await onChange(next); setDraft(String(next)); }
    catch { setDraft(String(offset)); }
    finally { setBusy(false); }
  };
  return <Popover><PopoverTrigger asChild><button type="button" className="lyric-calibration-trigger" title="歌词校准" aria-label="歌词校准"><Clock3 size={15} /></button></PopoverTrigger><PopoverContent side="top" align="end" className="lyric-calibration-panel">
    <strong>歌词时间校准</strong><p>正值延后，负值提前。{persistent ? '按歌曲保存。' : '仅本次有效。'}</p>
    <label>偏移（毫秒）<input aria-label="歌词偏移毫秒" type="number" min="-60000" max="60000" step="100" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} onBlur={() => void save(Number(draft))} onKeyDown={event => { if(event.key==='Enter') event.currentTarget.blur(); }} /></label>
    <div><button type="button" disabled={busy} onPointerDown={event => event.preventDefault()} onClick={() => void save(Number(draft)-100)}>提前 0.1 秒</button><button type="button" disabled={busy} onPointerDown={event => event.preventDefault()} onClick={() => void save(Number(draft)+100)}>延后 0.1 秒</button><button type="button" disabled={busy} onPointerDown={event => event.preventDefault()} onClick={() => { setDraft('0'); void save(0); }}>重置校准</button></div>
  </PopoverContent></Popover>;
}
