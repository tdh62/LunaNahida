import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { calculateFIRResponse, makeFrequencyImpulse, professionalGainLimit, responseAt, validateFilter, type CustomFilter } from '@/lib/audio-filter';
import { drawGainStroke, type GainPoint, type GainSegment } from '@/lib/gain-curve';

type Props = {
  filter: CustomFilter;
  sampleRate: number;
  professionalAudio: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onChange: (filter: CustomFilter) => void;
  onLive: (filter: CustomFilter) => void;
  expanded: boolean;
  onExpand: () => void;
};

export default function GainCurveEditor({ filter, sampleRate, professionalAudio, canUndo, canRedo, onUndo, onRedo, onChange, onLive, expanded, onExpand }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pen = useRef<{ id: number; points: GainPoint[]; original: CustomFilter; base: (hz: number) => number; lastPreview: number } | null>(null);
  const [strokeCurve, setStrokeCurve] = useState<GainSegment[] | null>(null);
  const [smoothing, setSmoothing] = useState(.2);
  const [cursor, setCursor] = useState<GainPoint | null>(null);
  const [error, setError] = useState('');
  const limit = professionalAudio ? professionalGainLimit : 24;
  const editable = filter.frequencyMode === 'curve';
  const minimum = Math.max(-limit, filter.gainMin ?? -12), maximum = Math.min(limit, filter.gainMax ?? 12);
  const maximumHz = sampleRate / 2;
  const compiled = useMemo(() => {
    try { return validateFilter(filter, sampleRate, professionalGainLimit); } catch { return null; }
  }, [filter, sampleRate]);
  const actual = useMemo(() => {
    if (!compiled) return null;
    const context = { sampleRate, createBuffer: (channels: number, length: number, rate: number) => new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate }) } as AudioContext;
    return calculateFIRResponse(makeFrequencyImpulse(context, hz => Math.max(-limit, Math.min(limit, compiled.frequency(hz))), filter.firSize, professionalGainLimit));
  }, [compiled, sampleRate, filter.firSize, limit]);
  useEffect(() => {
    // Mode or song-rate changes cancel an unfinished gesture.
    pen.current = null; setStrokeCurve(null);
  }, [professionalAudio, sampleRate, editable]);
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const draw = () => {
      const rect = element.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      if (!rect.width || !compiled) return;
      element.width = Math.round(rect.width * dpr); element.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
      const left = 45, right = rect.width - 14, top = 14, bottom = rect.height - 26;
      const x = (hz: number) => left + Math.log(hz / 20) / Math.log(maximumHz / 20) * (right - left);
      const y = (db: number) => bottom - (db - minimum) / (maximum - minimum) * (bottom - top);
      ctx.font = '10px sans-serif'; ctx.fillStyle = getComputedStyle(element).color;
      ctx.strokeStyle = 'rgba(130,150,140,.22)'; ctx.lineWidth = 1;
      for (const db of [minimum, minimum / 2, 0, maximum / 2, maximum]) {
        ctx.beginPath(); ctx.moveTo(left, y(db)); ctx.lineTo(right, y(db)); ctx.stroke();
        ctx.fillText(`${Math.round(db * 10) / 10}`, 5, y(db) + 3);
      }
      for (const hz of [20, 100, 1000, 10000, maximumHz]) {
        if (hz > maximumHz) continue;
        ctx.beginPath(); ctx.moveTo(x(hz), top); ctx.lineTo(x(hz), bottom); ctx.stroke();
        const label = hz >= 1000 ? `${Math.round(hz / 1000 * 10) / 10}k` : `${hz}`;
        if (hz !== maximumHz && x(hz) + ctx.measureText(label).width > right - 42) continue;
        ctx.fillText(label, Math.min(right - ctx.measureText(label).width, x(hz)), rect.height - 8);
      }
      let frequency = compiled.frequency;
      if (strokeCurve) {
        try { frequency = validateFilter({ ...filter, gainCurve: strokeCurve }, sampleRate, professionalGainLimit).frequency; } catch { /* Keep the last valid preview. */ }
      }
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
      const line = (evaluate: (hz: number) => number, color: string, dashed: boolean) => {
        ctx.strokeStyle = color; ctx.lineWidth = dashed ? 1.5 : 2; ctx.setLineDash(dashed ? [4, 3] : []); ctx.beginPath();
        for (let i = 0; i <= right - left; i++) {
          const hz = 20 * (maximumHz / 20) ** (i / (right - left)), py = y(evaluate(hz));
          if (!i) ctx.moveTo(left, py); else ctx.lineTo(left + i, py);
        }
        ctx.stroke();
      };
      if (actual) line(hz => responseAt(actual, hz), '#cf9b48', true);
      line(frequency, '#369b70', false); ctx.restore();
    };
    const observer = new ResizeObserver(draw); observer.observe(element); draw();
    return () => observer.disconnect();
  }, [compiled, actual, strokeCurve, filter, sampleRate, maximumHz, minimum, maximum]);

  const pointAt = (event: PointerEvent<HTMLCanvasElement>): GainPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (event.clientX - rect.left - 45) / (rect.width - 59)));
    const py = Math.max(0, Math.min(1, (event.clientY - rect.top - 14) / (rect.height - 40)));
    return { hz: 20 * (maximumHz / 20) ** px, db: maximum - py * (maximum - minimum) };
  };
  const update = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pointAt(event); setCursor(point);
    const active = pen.current; if (!active || event.pointerId !== active.id) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const item of events) active.points.push(pointAt({ ...event, clientX: item.clientX, clientY: item.clientY, currentTarget: event.currentTarget }));
    if (active.points.length > 4096) active.points = active.points.filter((_, i) => i % 2 === 0 || i === active.points.length - 1);
    const curve = drawGainStroke(active.original.gainCurve ?? [], active.points, active.base, smoothing);
    setStrokeCurve(curve);
    if (performance.now() - active.lastPreview >= 120) {
      active.lastPreview = performance.now(); onLive({ ...active.original, gainCurve: curve });
    }
  };
  const finish = (event: PointerEvent<HTMLCanvasElement>, cancel = false) => {
    const active = pen.current; if (!active || active.id !== event.pointerId) return;
    if (!cancel) update(event);
    pen.current = null; setStrokeCurve(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) { onLive(filter); return; }
    const curve = drawGainStroke(active.original.gainCurve ?? [], active.points, active.base, smoothing);
    const next = { ...active.original, gainCurve: curve };
    try {
      validateFilter(next, sampleRate, professionalGainLimit);
      if (curve !== active.original.gainCurve && curve.length) onChange(next);
      onLive(next); setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '曲线无法应用'); onLive(filter); }
  };
  return <div className="gain-editor">
    <div className="gain-toolbar"><strong>{editable ? '绘制增益曲线' : '公式频响预览'}</strong><div><button type="button" onClick={onExpand}>{expanded ? '收起绘制' : '展开绘制'}</button><button type="button" aria-label="撤销曲线修改" disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></button><button type="button" aria-label="重做曲线修改" disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></button><button type="button" disabled={!editable || !filter.gainCurve?.length} onClick={() => onChange({ ...filter, gainCurve: [] })}>清除绘制</button></div></div>
    <canvas ref={canvas} className={`processor-chart gain-canvas ${editable ? '' : 'gain-readonly'}`} aria-label={editable ? '绘制频率增益曲线' : '公式频率响应预览'} onPointerDown={event => {
      if (!editable || event.button !== 0 || !compiled || pen.current) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      pen.current = { id: event.pointerId, points: [pointAt(event)], original: filter, base: () => 0, lastPreview: 0 };
    }} onPointerMove={update} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={() => {
      if (pen.current) { pen.current = null; setStrokeCurve(null); onLive(filter); }
    }} onPointerLeave={() => { if (!pen.current) setCursor(null); }} />
    <div className="gain-legend"><span>实线：目标增益</span><span>虚线：实际滤波器频响</span><output>{cursor ? `${Math.round(cursor.hz)} Hz · ${cursor.db.toFixed(1)} dB` : editable ? '拖动绘制；新的一笔覆盖经过的频段' : '切换到绘制模式后可拖动修改'}</output></div>
    <div className="gain-controls"><label>下限 dB<input type="number" aria-label="绘图增益下限" min={-limit} max={-1} value={minimum} onChange={event => { const value = Number(event.target.value); if (value < 0 && value >= -limit) onChange({ ...filter, gainMin: value }); }} /></label><label>上限 dB<input type="number" aria-label="绘图增益上限" min={1} max={limit} value={maximum} onChange={event => { const value = Number(event.target.value); if (value > 0 && value <= limit) onChange({ ...filter, gainMax: value }); }} /></label><label>笔迹平滑<input type="range" aria-label="笔迹平滑程度" min="0" max="1" step=".1" value={smoothing} onChange={event => setSmoothing(Number(event.target.value))} /></label></div>
    <p className="processor-note">{editable ? '两端自动连接原曲线。' : ''}虚线不含五段均衡器和预衰减。{professionalAudio ? '专业模式：±60 dB' : '普通模式：±24 dB，超出部分播放时限制增益。'}</p>
    {error && <p className="processor-error" role="alert">{error}</p>}
    {!compiled && <p className="processor-error" role="alert">当前公式无效，请在高级编辑中修正后绘制。</p>}
  </div>;
}
