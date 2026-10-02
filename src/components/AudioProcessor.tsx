import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { compileExpression, defaultCustomFilter, effectNames, professionalGainLimit, selectedEffect, validateFilter, type CustomFilter, type SavedEffect } from '@/lib/audio-filter';
import GainCurveEditor from './GainCurveEditor';
import { formatTime } from '@/lib/music';

type Props = {
  professionalAudio: boolean;
  preampDb: number;
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

const copyFilter = (filter: CustomFilter): CustomFilter => ({ ...filter, gainCurve: filter.gainCurve?.map(segment => ({ points: segment.points.map(point => ({ ...point })) })), frequencyBands: filter.frequencyBands.map(band => ({ ...band })), delays: [...(filter.delays ?? [])] });
type EditorDraft = { filter: CustomFilter; name: string; editingId: string | null; baseline: string; undo: CustomFilter[]; redo: CustomFilter[] };

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
      ctx.fillStyle = '#a9b0ad'; ctx.font = `${10 * (Number(getComputedStyle(element).getPropertyValue('--ui-text-scale')) || 1)}px sans-serif`;
      const durationLabel = `${filter.durationMs} ms`;
      ctx.fillText('0', left, h - 4); ctx.fillText(durationLabel, right - ctx.measureText(durationLabel).width, h - 4);
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

export default function AudioProcessor({ professionalAudio, preampDb, open, onOpenChange, effect, setEffect, customEffects, onSave, onDelete, onPreview, filterError, sampleRate, hasTrack, trackTitle, playing, time, duration, onToggle, onSeek }: Props) {
  const selected = useMemo(() => selectedEffect(effect, customEffects), [effect, customEffects]);
  const [draft, setDraft] = useState<CustomFilter>(selected.filter);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<CustomFilter[]>([]), [redo, setRedo] = useState<CustomFilter[]>([]);
  const [bypass, setBypass] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const curveMode = draft.frequencyMode === 'curve';
  const updateDraft = (next: CustomFilter) => {
    setUndo(previous => [...previous.slice(-39), copyFilter(draft)]); setRedo([]); setDraft(next); setBypass(false);
  };
  const baseline = useRef('');
  const wasOpen = useRef(false);
  const loadedEffect = useRef<string | null>(null);
  const drafts = useRef(new Map<string, EditorDraft>());
  const newDraft = useRef<EditorDraft | null>(null);
  const creating = useRef(false);
  const forceSelection = useRef(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const snapshot = (): EditorDraft => ({ filter: copyFilter(draft), name, editingId, baseline: baseline.current, undo: [...undo], redo: [...redo] });
  const restore = (item: EditorDraft) => {
    setDraft(copyFilter(item.filter)); setName(item.name); setEditingId(item.editingId);
    baseline.current = item.baseline; setUndo([...item.undo]); setRedo([...item.redo]);
    setBypass(false); setError(null); setConfirmDiscard(false); setConfirmDeleteId(null);
  };
  const chooseEffect = (id: string) => {
    forceSelection.current = true;
    onPreview(null); setEffect(id); setSelectionRevision(value => value + 1);
  };
  useEffect(() => {
    if (!open) {
      wasOpen.current = false; loadedEffect.current = null; drafts.current.clear(); newDraft.current = null; creating.current = false; forceSelection.current = false;
      return;
    }
    const opening = !wasOpen.current;
    wasOpen.current = true;
    const switched = loadedEffect.current !== effect || forceSelection.current;
    forceSelection.current = false;
    if (!opening && !switched && JSON.stringify([draft, name, editingId]) !== baseline.current) return;
    const nextDraft = copyFilter(selected.filter);
    const nextName = customEffects.find(item => item.id === effect)?.name ?? `${selected.name} 副本`;
    const nextEditingId = customEffects.some(item => item.id === effect) ? effect : null;
    const ownSave = !opening && JSON.stringify(nextDraft) === JSON.stringify(draft) && nextName === name.trim();
    if (!opening && switched && !ownSave) {
      if (creating.current) newDraft.current = snapshot();
      else if (loadedEffect.current) drafts.current.set(loadedEffect.current, snapshot());
    }
    loadedEffect.current = effect; creating.current = false;
    const cached = !opening && switched && !ownSave ? drafts.current.get(effect) : null;
    if (cached) { restore(cached); return; }
    baseline.current = JSON.stringify([nextDraft, nextName, nextEditingId]);
    setDraft(nextDraft); setName(nextName); setEditingId(nextEditingId);
    if (!ownSave) { setUndo([]); setRedo([]); }
    setBypass(false);
    setConfirmDeleteId(null); setConfirmDiscard(false); setError(null);
  }, [open, effect, selected, customEffects, selectionRevision]);
  const dirty = JSON.stringify([draft, name, editingId]) !== baseline.current;
  const hasUnsavedDrafts = dirty || [...drafts.current.entries()].some(([id, item]) =>
    (effectNames.some(name => name === id) || customEffects.some(effect => effect.id === id)) && JSON.stringify([item.filter, item.name, item.editingId]) !== item.baseline)
    || Boolean(newDraft.current && JSON.stringify([newDraft.current.filter, newDraft.current.name, newDraft.current.editingId]) !== newDraft.current.baseline);
  useEffect(() => {
    if (!open) { onPreview(null); return; }
    if (bypass) { onPreview(defaultCustomFilter); return; }
    try { validateFilter(draft, sampleRate, professionalGainLimit); } catch { return; }
    const timeout = window.setTimeout(() => onPreview(draft), 120);
    return () => window.clearTimeout(timeout);
  }, [open, draft, sampleRate, onPreview, bypass]);
  const close = (nextOpen: boolean) => {
    if (nextOpen) { onOpenChange(true); return; }
    if (hasUnsavedDrafts) { setConfirmDiscard(true); return; }
    onPreview(null); onOpenChange(false);
  };
  const create = (filter?: CustomFilter, title = '') => {
    if (!creating.current && loadedEffect.current) drafts.current.set(loadedEffect.current, snapshot());
    creating.current = true;
    setSelectionRevision(value => value + 1);
    if (!filter && newDraft.current) { restore(newDraft.current); return; }
    filter ??= { ...defaultCustomFilter, frequencyMode: 'curve' };
    setDraft(copyFilter(filter));
    setUndo([]); setRedo([]); setBypass(false);
    setName(title); setEditingId(null); setConfirmDeleteId(null); setError(null);
  };
  const save = () => {
    try {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 60) throw new Error('名称须为 1–60 个字符');
      if (!editingId && customEffects.length >= 40) throw new Error('最多保存 40 个自定义音效');
      if (customEffects.some(item => item.id !== editingId && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('已有同名音效');
      validateFilter(draft, sampleRate, professionalGainLimit);
      if (!professionalAudio && !curveMode && JSON.stringify(draft.frequencyBands) !== JSON.stringify(selected.filter.frequencyBands)) {
        validateFilter({ ...draft, gainCurve: [] }, sampleRate);
      }
      baseline.current = JSON.stringify([draft, name, editingId]);
      onSave(trimmed, draft, editingId ?? undefined); onPreview(null); setConfirmDiscard(false); setError(null);
      if (loadedEffect.current && !creating.current) drafts.current.delete(loadedEffect.current);
      if (creating.current) newDraft.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '表达式无效'); }
  };
  const preview = (() => { try { validateFilter(draft, sampleRate, professionalGainLimit); return draft; } catch { return selected.filter; } })();
  return <Dialog modal={false} open={open} onOpenChange={close}><DialogContent className={`music-dialog processor-dialog ${expanded ? "processor-expanded" : ""}`} showOverlay={false} showClose={false} onInteractOutside={event => event.preventDefault()}><DialogTitle>音效处理器</DialogTitle><DialogDescription className="sr-only">音效处理器</DialogDescription><div className="processor-audition"><button type="button" className="processor-audition-toggle" disabled={!hasTrack} onClick={onToggle} aria-label={playing ? '暂停试听' : '播放试听'} title={playing ? '暂停试听' : '播放试听'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><span className="processor-audition-title">{hasTrack ? trackTitle : '暂无歌曲'}</span><span className="processor-audition-time">{formatTime(time)}</span><input type="range" aria-label="试听进度" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(time, Math.max(1, duration))} disabled={!hasTrack} onChange={event => onSeek(Number(event.target.value))} /><span className="processor-audition-time">{formatTime(duration)}</span></div><div className="processor-body"><div className="processor-layout">
    <aside className="processor-list"><div className="processor-list-heading"><strong>内置音效</strong><button type="button" disabled={customEffects.length >= 40} onClick={() => create()}><Plus size={14} />新建</button></div>{effectNames.map(item => <button type="button" key={item} className={`processor-list-item ${effect === item ? 'active' : ''}`} onClick={() => chooseEffect(item)}>{item}{effect === item && <Check size={14} />}</button>)}<strong className="processor-list-label">我的音效</strong>{customEffects.length ? customEffects.map(item => <div className="processor-saved-item" key={item.id}><button type="button" className={`processor-list-item ${effect === item.id ? 'active' : ''}`} onClick={() => chooseEffect(item.id)}>{item.name}{effect === item.id && <Check size={14} />}</button><button type="button" title={`删除 ${item.name}`} aria-label={`删除 ${item.name}`} onClick={() => setConfirmDeleteId(item.id)}><Trash2 size={14} /></button></div>) : <small>暂无自定义音效</small>}</aside>
    <div className="audio-processor"><div className="processor-heading"><strong>{editingId ? '编辑音效' : '新建音效'}</strong><button type="button" disabled={customEffects.length >= 40} onClick={() => create(selected.filter, `${selected.name} 副本`)}>复制当前音效</button></div>
    <label className="processor-name">名称<input value={name} maxLength={60} onChange={event => setName(event.target.value)} placeholder="音效名称" /></label>
    <div className="gain-mode" role="group" aria-label="频率增益设置方式"><button type="button" aria-pressed={curveMode} onClick={() => updateDraft({ ...draft, frequencyMode: 'curve' })}>绘制曲线</button><button type="button" aria-pressed={!curveMode} onClick={() => updateDraft({ ...draft, frequencyMode: 'formula' })}>频率公式</button></div>
    <GainCurveEditor key={selectionRevision} expanded={expanded} onExpand={() => setExpanded(!expanded)} filter={draft} sampleRate={sampleRate} professionalAudio={professionalAudio} canUndo={undo.length > 0} canRedo={redo.length > 0} onChange={updateDraft} onLive={filter => { if (!bypass) onPreview(filter); }} onUndo={() => { const last = undo[undo.length - 1]; if (!last) return; setRedo(items => [...items, copyFilter(draft)]); setUndo(items => items.slice(0, -1)); setDraft(last); setBypass(false); }} onRedo={() => { const last = redo[redo.length - 1]; if (!last) return; setUndo(items => [...items, copyFilter(draft)]); setRedo(items => items.slice(0, -1)); setDraft(last); setBypass(false); }} />
    <div className="processor-comparison"><button type="button" aria-pressed={bypass} onClick={() => setBypass(!bypass)}>{bypass ? '恢复音效试听' : '旁路音效对比'}</button><span>自动预衰减 {preampDb.toFixed(1)} dB</span></div>
    <details key={curveMode ? "curve" : "formula"} open={!curveMode || undefined} className="processor-advanced"><summary>高级公式与回响</summary><div className="processor-chart-title">时间响应</div><TimeChart filter={preview} />
    <div className="processor-form">
      <div className="processor-bands" hidden={curveMode}><div className="processor-bands-heading"><strong>频率函数</strong><button type="button" disabled={draft.frequencyBands.length >= 8} onClick={() => updateDraft({ ...draft, frequencyBands: [...draft.frequencyBands, { expression: '0', startHz: 0, endHz: null, transitionHz: 80 }] })}><Plus size={14} />添加函数</button></div>{draft.frequencyBands.map((band, index) => <div className="processor-band" key={index}><div className="processor-band-heading"><strong>频段 {index + 1}</strong><button type="button" disabled={draft.frequencyBands.length <= 1} aria-label={`删除第 ${index + 1} 条频率函数`} title="删除频率函数" onClick={() => updateDraft({ ...draft, frequencyBands: draft.frequencyBands.filter((_, i) => i !== index) })}><Trash2 size={15} /></button></div><label>频率响应 <span>f = Hz，结果 = dB</span><input value={band.expression} onChange={event => updateDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, expression: event.target.value } : item) })} spellCheck={false} aria-label={`第 ${index + 1} 条频率响应表达式`} /></label><div className="processor-band-range"><label>起点 Hz <input type="number" min="0" max={Math.round(sampleRate / 2)} step="1" value={band.startHz} onChange={event => updateDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, startHz: Number(event.target.value) } : item) })} /></label><label>终点 Hz <input type="number" min="1" max={Math.round(sampleRate / 2)} step="1" value={band.endHz ?? Math.round(sampleRate / 2)} disabled={band.endHz === null} onChange={event => updateDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, endHz: Number(event.target.value) } : item) })} /></label><label>平滑宽度 Hz <input type="number" min="0" max="10000" step="10" value={band.transitionHz} onChange={event => updateDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, transitionHz: Number(event.target.value) } : item) })} /></label><label className="processor-band-auto"><input type="checkbox" checked={band.endHz === null} onChange={event => updateDraft({ ...draft, frequencyBands: draft.frequencyBands.map((item, i) => i === index ? { ...item, endHz: event.target.checked ? null : Math.max(item.startHz + 1, Math.round(sampleRate / 2)) } : item) })} />歌曲上限</label></div></div>)}</div>
      <label className="processor-fir-size">FIR 点数 <span>约 {Math.round(draft.firSize / 2 / sampleRate * 1000)} ms 处理延迟</span><select value={draft.firSize} onChange={event => updateDraft({ ...draft, firSize: Number(event.target.value) as CustomFilter['firSize'] })}>{[2048, 4096, 8192, 16384].map(size => <option key={size} value={size}>{size} 点</option>)}</select></label>
      <label>时间响应 <span>t = 秒，结果 = 每秒混合增益</span><input value={draft.time} onChange={event => updateDraft({ ...draft, time: event.target.value })} spellCheck={false} aria-label="时间响应表达式" /></label>
      <label className="processor-duration">响应长度 <span>{draft.durationMs} ms</span><input type="range" min="50" max="1000" step="10" value={draft.durationMs} onChange={event => updateDraft({ ...draft, durationMs: Number(event.target.value) })} /></label>
      <div className="processor-delays"><div><strong>延迟点</strong><button type="button" disabled={(draft.delays?.length ?? 0) >= 8} onClick={() => updateDraft({ ...draft, delays: [...(draft.delays ?? []), { ms: Math.min(190, draft.durationMs), gain: 0.3 }] })}><Plus size={14} />添加</button></div>{(draft.delays ?? []).map((delay, index) => <div className="processor-delay" key={index}><label>时间 <input type="number" min="1" max={draft.durationMs} value={delay.ms} onChange={event => updateDraft({ ...draft, delays: draft.delays.map((item, i) => i === index ? { ...item, ms: Number(event.target.value) } : item) })} /> ms</label><label>增益 <input type="number" min="-1" max="1" step="0.05" value={delay.gain} onChange={event => updateDraft({ ...draft, delays: draft.delays.map((item, i) => i === index ? { ...item, gain: Number(event.target.value) } : item) })} /></label><button type="button" aria-label={`删除第 ${index + 1} 个延迟点`} title="删除延迟点" onClick={() => updateDraft({ ...draft, delays: draft.delays.filter((_, i) => i !== index) })}><Trash2 size={15} /></button></div>)}</div>
      </div></details>
    </div></div></div>
    <footer className="processor-footer">
      {(error || filterError) && <p className="processor-error" role="alert">{error || filterError}</p>}
      <div className="processor-actions">
        <button type="button" onClick={() => { updateDraft(copyFilter(selected.filter)); setError(null); }} title="重置编辑内容"><RotateCcw size={15} />重置</button>
        <button type="button" onClick={() => close(false)}>关闭</button>
        <button type="button" className="processor-save" onClick={save}><Check size={15} />保存并启用</button>
      </div>
    </footer>
    <AlertDialog.Root open={confirmDiscard || Boolean(confirmDeleteId)} onOpenChange={next => { if (!next) { setConfirmDiscard(false); setConfirmDeleteId(null); } }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="processor-confirm" />
        <AlertDialog.Content className="processor-confirm-panel music-dialog">
          <AlertDialog.Title className="sr-only">{confirmDiscard ? '放弃未保存的音效修改' : '确认删除音效'}</AlertDialog.Title>
          <AlertDialog.Description>{confirmDiscard ? '音效尚未保存，放弃修改？' : `删除「${customEffects.find(item => item.id === confirmDeleteId)?.name}」？`}</AlertDialog.Description>
          <AlertDialog.Cancel>{confirmDiscard ? '继续编辑' : '取消'}</AlertDialog.Cancel>
          <AlertDialog.Action onClick={() => {
            if (confirmDiscard) { onPreview(null); onOpenChange(false); }
            else if (confirmDeleteId) onDelete(confirmDeleteId);
          }}>{confirmDiscard ? '放弃修改' : '删除'}</AlertDialog.Action>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
    </DialogContent></Dialog>;
}
