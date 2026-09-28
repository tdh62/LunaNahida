import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { compileExpression, defaultCustomFilter, effectNames, selectedEffect, validateFilter, type CustomFilter, type SavedEffect } from '@/lib/audio-filter';
import { formatTime } from '@/lib/music';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  effect: string;
  setEffect: (effect: string) => void;
  customEffects: SavedEffect[];
  onSave: (name: string, filter: CustomFilter, id?: string) => void;
  onDelete: (id: string) => void;
  onPreview: (filter: CustomFilter | null) => void;
  filterError: string | null;
  sampleRate: number;
  hasTrack: boolean;
  trackTitle: string;
  playing: boolean;
  time: number;
  duration: number;
  onToggle: () => void;
  onSeek: (time: number) => void;
};

const copyFilter = (filter: CustomFilter): CustomFilter => ({ ...filter, frequencyBands: filter.frequencyBands.map(band => ({ ...band })), delays: [...(filter.delays ?? [])] });

function ResponseChart({ filter, effect, sampleRate }: { filter: CustomFilter; effect: string; sampleRate: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const draw = () => {
      const rect = element.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (!rect.width) return;
      element.width = Math.round(rect.width * dpr); element.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width, h = rect.height, pad = 22;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#555e5d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, h / 2); ctx.lineTo(w - 8, h / 2); ctx.stroke();
      ctx.fillStyle = '#a9b0ad'; ctx.font = '10px sans-serif';
      ctx.fillText('20', pad, h - 5); ctx.fillText(`${Math.round(sampleRate / 2000)}k Hz`, w - 48, h - 5);
      let frequency: (value: number) => number;
      try { frequency = validateFilter(filter, sampleRate).frequency; } catch { return; }
      ctx.strokeStyle = 'rgba(131,200,171,.25)'; ctx.lineWidth = 1;
      for (const band of filter.frequencyBands) {
        for (const edge of [band.startHz, band.endHz]) {
          if (edge === null || edge <= 20 || edge >= sampleRate / 2) continue;
          const x = pad + Math.log(edge / 20) / Math.log(sampleRate / 40) * (w - pad - 8);
          ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, h - 15); ctx.stroke();
        }
      }
      ctx.strokeStyle = '#83c8ab'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= w - pad - 8; i++) {
        const f = 20 * (sampleRate / 40) ** (i / (w - pad - 8));
        const gain = frequency(f);
        if (!Number.isFinite(gain)) continue;
        const y = Math.max(8, Math.min(h - 15, h / 2 - gain / 24 * (h / 2 - 12)));
        if (i === 0) ctx.moveTo(pad, y); else ctx.lineTo(pad + i, y);
      }
      ctx.stroke();
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw();
    return () => observer.disconnect();
  }, [filter, effect, sampleRate]);
  return <canvas ref={canvas} className="processor-chart" role="img" aria-label="滤波器频率响应预览" />;
}

function TimeChart({ filter }: { filter: CustomFilter }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const draw = () => {
      const rect = element.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (!rect.width) return;
      element.width = Math.round(rect.width * dpr); element.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width, h = rect.height, left = 22, right = w - 8, baseline = h - 18;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#555e5d'; ctx.beginPath(); ctx.moveTo(left, baseline); ctx.lineTo(right, baseline); ctx.stroke();
      ctx.fillStyle = '#a9b0ad'; ctx.font = '10px sans-serif';
      ctx.fillText('0', left, h - 4); ctx.fillText(`${filter.durationMs} ms`, right - 42, h - 4);
      let time: (value: number) => number;
      try { time = compileExpression(filter.time, 't'); } catch { return; }
      ctx.strokeStyle = '#90baca'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= right - left; i++) {
        const value = time(i / (right - left) * filter.durationMs / 1000);
        const y = baseline - Math.min(1, Math.max(-1, value / 10)) * (h - 28);
        if (i === 0) ctx.moveTo(left, y); else ctx.lineTo(left + i, y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#e2a980'; ctx.lineWidth = 2;
      for (const delay of filter.delays ?? []) {
        const x = left + delay.ms / filter.durationMs * (right - left);
        ctx.beginPath(); ctx.moveTo(x, baseline); ctx.lineTo(x, baseline - delay.gain * (h - 28)); ctx.stroke();
      }
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw();
    return () => observer.disconnect();
  }, [filter]);
  return <canvas ref={canvas} className="processor-chart processor-time-chart" role="img" aria-label="时间响应与延迟点预览" />;
}

export default function AudioProcessor({ open, onOpenChange, effect, setEffect, customEffects, onSave, onDelete, onPreview, filterError, sampleRate, hasTrack, trackTitle, playing, time, duration, onToggle, onSeek }: Props) {
  const selected = useMemo(() => selectedEffect(effect, customEffects), [effect, customEffects]);
  const [draft, setDraft] = useState<CustomFilter>(selected.filter);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseline = useRef('');
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    const opening = !wasOpen.current;
    wasOpen.current = true;
    if (!opening && JSON.stringify([draft, name, editingId]) !== baseline.current) return;
    const nextDraft = copyFilter(selected.filter);
    const nextName = customEffects.find(item => item.id === effect)?.name ?? `${selected.name} 副本`;
    const nextEditingId = customEffects.some(item => item.id === effect) ? effect : null;
    baseline.current = JSON.stringify([nextDraft, nextName, nextEditingId]);
    setDraft(nextDraft); setName(nextName); setEditingId(nextEditingId);
    setConfirmDeleteId(null); setConfirmDiscard(false); setError(null);
  }, [open, effect, selected, customEffects]);
  const dirty = JSON.stringify([draft, name, editingId]) !== baseline.current;
  useEffect(() => {
    if (!open) { onPreview(null); return; }
    try { validateFilter(draft, sampleRate); } catch { return; }
    const timeout = window.setTimeout(() => onPreview(draft), 220);
    return () => window.clearTimeout(timeout);
  }, [open, draft, sampleRate, onPreview]);
  const close = (nextOpen: boolean) => {
    if (nextOpen) { onOpenChange(true); return; }
    if (dirty) { setConfirmDiscard(true); return; }
    onPreview(null); onOpenChange(false);
  };
  const create = (filter: CustomFilter = defaultCustomFilter, title = '') => {
    setDraft(copyFilter(filter));
    setName(title); setEditingId(null); setConfirmDeleteId(null); setError(null);
  };
  const save = () => {
    try {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 60) throw new Error('名称须为 1–60 个字符');
      if (!editingId && customEffects.length >= 40) throw new Error('最多保存 40 个自定义音效');
      if (customEffects.some(item => item.id !== editingId && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('已有同名音效');
      validateFilter(draft, sampleRate);
      baseline.current = JSON.stringify([draft, name, editingId]);
      onSave(trimmed, draft, editingId ?? undefined); onPreview(null); setConfirmDiscard(false); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '表达式无效'); }
  };
  const preview = (() => { try { validateFilter(draft, sampleRate); return draft; } catch { return selected.filter; } })();
  return <Dialog modal={false} open={open} onOpenChange={close}><DialogContent className="music-dialog processor-dialog" showOverlay={false} onInteractOutside={event => event.preventDefault()}><DialogTitle>音效处理器</DialogTitle><DialogDescription>FIR 频率响应与时间响应</DialogDescription><div className="processor-audition"><button type="button" className="processor-audition-toggle" disabled={!hasTrack} onClick={onToggle} aria-label={playing ? '暂停试听' : '播放试听'} title={playing ? '暂停试听' : '播放试听'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><span className="processor-audition-title">{hasTrack ? trackTitle : '暂无歌曲'}</span><span className="processor-audition-time">{formatTime(time)}</span><input type="range" aria-label="试听进度" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(time, Math.max(1, duration))} disabled={!hasTrack} onChange={event => onSeek(Number(event.target.value))} /><span className="processor-audition-time">{formatTime(duration)}</span></div><div className="processor-layout">
    <aside className="processor-list"><div className="processor-list-heading"><strong>内置音效</strong><button type="button" disabled={customEffects.length >= 40} onClick={() => create()}><Plus size={14} />新建</button></div>{effectNames.map(item => <button type="button" key={item} className={`processor-list-item ${effect === item ? 'active' : ''}`} onClick={() => setEffect(item)}>{item}{effect === item && <Check size={14} />}</button>)}<strong className="processor-list-label">我的音效</strong>{customEffects.length ? customEffects.map(item => <div className="processor-saved-item" key={item.id}><button type="button" className={`processor-list-item ${effect === item.id ? 'active' : ''}`} onClick={() => setEffect(item.id)}>{item.name}{effect === item.id && <Check size={14} />}</button><button type="button" title={`删除 ${item.name}`} aria-label={`删除 ${item.name}`} onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={14} /></button></div>) : <small>暂无自定义音效</small>}</aside>
    <div className="audio-processor"><div className="processor-heading"><strong>{editingId ? '编辑音效' : '新建音效'}</strong><button type="button" disabled={customEffects.length >= 40} onClick={() => create(selected.filter, `${selected.name} 副本`)}>复制当前音效</button></div>
    <label className="processor-name">名称<input value={name} maxLength={60} onChange={event => setName(event.target.value)} placeholder="音效名称" /></label>
    <div className="processor-charts"><div><span className="processor-chart-title">函数频响</span><ResponseChart filter={preview} effect={effect} sampleRate={sampleRate} /></div><div><span className="processor-chart-title">时间响应</span><TimeChart filter={preview} /></div></div>
    <div className="processor-form">
      <div className="processor-bands"><div className="processor-bands-heading"><strong>频率函数</strong><button type="button" disabled={draft.frequencyBands.length >= 8} onClick={() => setDraft({ ...draft, frequencyBands: [...draft.frequencyBands, { expression: '0', startHz: 0, endHz: null, transitionHz: 80 }] })}><Plus size={14} />添加函数</button></div>{draft.frequencyBands.map((band, index) => <div className="processor-band" key={index}><div className="processor-band-heading"><strong>频段 {index + 1}</strong><button type="button" disabled={draft.frequencyBands.length <= 1} aria-label={`删除第 ${index + 1} 条频率函数`} title="删除频率函数" onClick={() => setDraft({ ...draft, frequencyBands: draft.frequencyBands.filter((_, i) => i !== index) })}><Trash2 size={15} /></button></div><label>频率响应 <span>f = Hz，结果 = dB</span><input value={band.expression} onChange={event => setDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, expression: event.target.value } : item) })} spellCheck={false} aria-label={`第 ${index + 1} 条频率响应表达式`} /></label><div className="processor-band-range"><label>起点 Hz <input type="number" min="0" max={Math.round(sampleRate / 2)} step="1" value={band.startHz} onChange={event => setDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, startHz: Number(event.target.value) } : item) })} /></label><label>终点 Hz <input type="number" min="1" max={Math.round(sampleRate / 2)} step="1" value={band.endHz ?? Math.round(sampleRate / 2)} disabled={band.endHz === null} onChange={event => setDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, endHz: Number(event.target.value) } : item) })} /></label><label>平滑宽度 Hz <input type="number" min="0" max="10000" step="10" value={band.transitionHz} onChange={event => setDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, transitionHz: Number(event.target.value) } : item) })} /></label><label className="processor-band-auto"><input type="checkbox" checked={band.endHz === null} onChange={event => setDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, endHz: event.target.checked ? null : Math.max(item.startHz + 1, Math.round(sampleRate / 2)) } : item) })} />歌曲上限</label></div></div>)}</div>
      <label className="processor-fir-size">FIR 点数 <span>约 {Math.round(draft.firSize / 2 / sampleRate * 1000)} ms 处理延迟</span><select value={draft.firSize} onChange={event => setDraft({ ...draft, firSize: Number(event.target.value) as CustomFilter['firSize'] })}>{[2048, 4096, 8192, 16384].map(size => <option key={size} value={size}>{size} 点</option>)}</select></label>
      <label>时间响应 <span>t = 秒，结果 = 每秒混合增益</span><input value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} spellCheck={false} aria-label="时间响应表达式" /></label>
      <label className="processor-duration">响应长度 <span>{draft.durationMs} ms</span><input type="range" min="50" max="1000" step="10" value={draft.durationMs} onChange={event => setDraft({ ...draft, durationMs: Number(event.target.value) })} /></label>
      <div className="processor-delays"><div><strong>延迟点</strong><button type="button" disabled={(draft.delays?.length ?? 0) >= 8} onClick={() => setDraft({ ...draft, delays: [...(draft.delays ?? []), { ms: Math.min(190, draft.durationMs), gain: 0.3 }] })}><Plus size={14} />添加</button></div>{(draft.delays ?? []).map((delay, index) => <div className="processor-delay" key={index}><label>时间 <input type="number" min="1" max={draft.durationMs} value={delay.ms} onChange={event => setDraft({ ...draft, delays: draft.delays.map((item, i) => i === index ? { ...item, ms: Number(event.target.value) } : item) })} /> ms</label><label>增益 <input type="number" min="-1" max="1" step="0.05" value={delay.gain} onChange={event => setDraft({ ...draft, delays: draft.delays.map((item, i) => i === index ? { ...item, gain: Number(event.target.value) } : item) })} /></label><button type="button" aria-label={`删除第 ${index + 1} 个延迟点`} title="删除延迟点" onClick={() => setDraft({ ...draft, delays: draft.delays.filter((_, i) => i !== index) })}><Trash2 size={15} /></button></div>)}</div>
      {(error || filterError) && <p className="processor-error" role="alert">{error || filterError}</p>}
      <div className="processor-actions"><button type="button" onClick={save}><Check size={15} />保存并启用</button><button type="button" onClick={() => { setDraft(copyFilter(selected.filter)); setError(null); }} title="重置编辑内容"><RotateCcw size={15} />重置</button></div>
    </div>
    </div></div>{confirmDeleteId && <div className="processor-confirm" role="alertdialog" aria-label="确认删除音效"><div className="processor-confirm-panel"><span>删除「{customEffects.find(item => item.id === confirmDeleteId)?.name}」？</span><button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button><button type="button" onClick={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }}>删除</button></div></div>}{confirmDiscard && <div className="processor-confirm" role="alertdialog" aria-label="放弃未保存的音效修改"><div className="processor-confirm-panel"><span>音效尚未保存，放弃修改？</span><button type="button" onClick={() => setConfirmDiscard(false)}>继续编辑</button><button type="button" onClick={() => { onPreview(null); setConfirmDiscard(false); onOpenChange(false); }}>放弃修改</button></div></div>}</DialogContent></Dialog>;
}
