import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export default function LyricCalibration({ offset, persistent, onChange }: { offset: number; persistent: boolean; onChange: (value: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const save = async (value: number) => {
    if (busy || !Number.isFinite(value)) return;
    setBusy(true);
    try { await onChange(Math.max(-60000, Math.min(60000, Math.round(value)))); }
    finally { setBusy(false); }
  };
  return <Popover><PopoverTrigger asChild><button type="button" className="lyric-calibration-trigger">歌词校准</button></PopoverTrigger><PopoverContent className="lyric-calibration-panel">
    <strong>歌词时间校准</strong><p>正值延后，负值提前。{persistent ? '仅对这首歌生效，自动保存。' : '仅本次播放有效。'}</p>
    <label>偏移（毫秒）<input key={offset} aria-label="歌词偏移毫秒" type="number" min="-60000" max="60000" step="100" defaultValue={offset} disabled={busy} onBlur={event => void save(Number(event.target.value))} onKeyDown={event => { if(event.key==='Enter') event.currentTarget.blur(); }} /></label>
    <div><button type="button" disabled={busy} onClick={() => void save(offset-100)}>提前 0.1 秒</button><button type="button" disabled={busy} onClick={() => void save(offset+100)}>延后 0.1 秒</button><button type="button" disabled={busy} onClick={() => void save(0)}>重置校准</button></div>
  </PopoverContent></Popover>;
}
