import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Minimize2 } from 'lucide-react';
import type { ScopeSettings } from '@/lib/backend';
import { detectSampleRate } from '@/lib/audio-sample-rate';
import { frequencyResponseBounds, responseAt, type FrequencyResponse } from '@/lib/audio-filter';
import { defaultScopeNotePreferences, getScopeNotes, layoutScopeNoteLabels, noteAt, readScopeNotePreferences, scopeNoteStorageKey } from '@/lib/scope-notes';

type Props = {
  analyser: AnalyserNode | null;
  response: FrequencyResponse | null;
  active: boolean;
  trackId: number | null;
  title: string;
  artist: string;
  sampleRate?: number;
  browserFile?: boolean;
  settings: ScopeSettings;
  onSettingsChange: (settings: ScopeSettings) => void;
  onClose: () => void;
};

const PAD = { left: 48, right: 46, top: 22, bottom: 36 };
const hzMarks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

function formatHz(value: number) {
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : `${Math.round(value)}`;
}

export default function ExpandedScope({ analyser, response, active, trackId, title, artist, sampleRate, browserFile = false, settings, onSettingsChange, onClose }: Props) {
  const gainBounds = useMemo(() => frequencyResponseBounds(response), [response]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<() => void>(() => {});
  const pointer = useRef<number | null>(null);
  const frequencyFrame = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const waveFrame = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [frameModes, setFrameModes] = useState({ spectrum: false, waveform: false });
  const [readout, setReadout] = useState<string | null>(null);
  const [detectedRate, setDetectedRate] = useState<number | null>(null);
  const [notePreferences, setNotePreferences] = useState(() => {
    try { return readScopeNotePreferences(window.localStorage); }
    catch { return { ...defaultScopeNotePreferences }; }
  });
  const nyquist = Math.floor(Math.max(100, Math.min((sampleRate || detectedRate || analyser?.context.sampleRate || 44100) / 2, (analyser?.context.sampleRate || sampleRate || detectedRate || 44100) / 2)));
  const minHz = Math.max(20, Math.min(settings.minFrequency || 20, nyquist - 20));
  const maxHz = Math.max(minHz + 10, Math.min(settings.maxFrequency, nyquist));
  const notes = useMemo(() => notePreferences.enabled ? getScopeNotes(minHz, maxHz, notePreferences.count) : [], [minHz, maxHz, notePreferences]);

  useEffect(() => {
    try { window.localStorage.setItem(scopeNoteStorageKey, JSON.stringify(notePreferences)); }
    catch { return; }
  }, [notePreferences]);

  useEffect(() => {
    frequencyFrame.current = null;
    waveFrame.current = null;
    pointer.current = null;
    setFrameModes({ spectrum: false, waveform: false });
    setReadout(null);
  }, [trackId]);

  useEffect(() => {
    setDetectedRate(null);
    if (sampleRate || trackId === null || browserFile) return;
    const controller = new AbortController();
    void fetch(`/api/media/audio/${trackId}`, { headers: { Range: 'bytes=0-262143' }, signal: controller.signal })
      .then(async response => response.status === 206 ? detectSampleRate(new Uint8Array(await response.arrayBuffer())) : null)
      .then(rate => { if (!controller.signal.aborted) setDetectedRate(rate); })
      .catch(() => {});
    return () => controller.abort();
  }, [trackId, sampleRate, browserFile]);

  useEffect(() => {
    if (!analyser) return;
    analyser.fftSize = settings.fftSize;
    frequencyFrame.current = null;
    waveFrame.current = null;
    setFrameModes({ spectrum: false, waveform: false });
  }, [analyser, settings.fftSize]);
  useEffect(() => { if (analyser) analyser.smoothingTimeConstant = settings.smoothing; }, [analyser, settings.smoothing]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    const draw = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
      if (element.width !== pixelWidth || element.height !== pixelHeight) { element.width = pixelWidth; element.height = pixelHeight; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = rect.width, height = rect.height;
      const plotTop = settings.mode === 'spectrum' && notePreferences.enabled ? 44 : PAD.top;
      const plotWidth = Math.max(1, width - PAD.left - PAD.right);
      const plotHeight = Math.max(1, height - plotTop - PAD.bottom);
      const right = PAD.left + plotWidth, bottom = plotTop + plotHeight;
      const color = getComputedStyle(element).color;
      const muted = getComputedStyle(element).getPropertyValue('--scope-muted').trim() || '#95999e';
      context.clearRect(0, 0, width, height);
      context.font = '11px "DM Mono", monospace';
      context.textBaseline = 'middle';

      if (analyser && active) {
        if (settings.mode === 'spectrum') {
          if (!frequencyFrame.current || frequencyFrame.current.length !== analyser.frequencyBinCount) {
            frequencyFrame.current = new Uint8Array(analyser.frequencyBinCount);
            setFrameModes(previous => previous.spectrum ? previous : { ...previous, spectrum: true });
          }
          analyser.getByteFrequencyData(frequencyFrame.current);
        } else {
          if (!waveFrame.current || waveFrame.current.length !== analyser.fftSize) {
            waveFrame.current = new Uint8Array(analyser.fftSize);
            setFrameModes(previous => previous.waveform ? previous : { ...previous, waveform: true });
          }
          analyser.getByteTimeDomainData(waveFrame.current);
        }
      }

      context.strokeStyle = 'rgba(150,156,160,.18)';
      context.fillStyle = muted;
      context.lineWidth = 1;
      if (settings.mode === 'spectrum') {
        const xAt = (frequency: number) => PAD.left + Math.log(frequency / minHz) / Math.log(maxHz / minHz) * plotWidth;
        for (const db of [-20, -40, -60, -80, -100]) {
          const y = plotTop + (-20 - db) / 80 * plotHeight;
          context.beginPath(); context.moveTo(PAD.left, y); context.lineTo(right, y); context.stroke();
          context.fillText(`${db}`, 5, y);
        }
        if (active && response) {
          context.save();
          context.strokeStyle = 'rgba(234,177,124,.55)';
          context.fillStyle = '#eab17c';
          context.textAlign = 'left';
          context.setLineDash([3, 5]);
          const zeroY = plotTop + gainBounds.maximum / (gainBounds.maximum - gainBounds.minimum) * plotHeight;
          context.beginPath(); context.moveTo(PAD.left, zeroY); context.lineTo(right, zeroY); context.stroke();
          context.setLineDash([]);
          for (const gain of [gainBounds.maximum, 0, -24, gainBounds.minimum]) {
            const y = plotTop + (gainBounds.maximum - gain) / (gainBounds.maximum - gainBounds.minimum) * plotHeight;
            context.fillText(`${gain > 0 ? '+' : ''}${gain}`, right + 5, y);
          }
          context.restore();
        }
        for (const hz of hzMarks) {
          if (hz < minHz || hz > maxHz) continue;
          const x = xAt(hz);
          context.beginPath(); context.moveTo(x, plotTop); context.lineTo(x, bottom); context.stroke();
          if (x - PAD.left > 30 && right - x > 30) { context.textAlign = 'center'; context.fillText(formatHz(hz), x, bottom + 22); }
        }
        context.textAlign = 'left'; context.fillText(formatHz(minHz), PAD.left, bottom + 22);
        context.textAlign = 'right'; context.fillText(formatHz(maxHz), right, bottom + 22);
        for (const note of notes) {
          const x = xAt(note.frequency);
          context.strokeStyle = note.midi === 69 ? color : 'rgba(160,180,160,.3)';
          context.setLineDash(note.midi === 69 ? [4, 4] : [2, 5]);
          context.beginPath(); context.moveTo(x, plotTop); context.lineTo(x, bottom); context.stroke();
        }
        context.setLineDash([]);
        context.textAlign = 'center';
        for (const label of layoutScopeNoteLabels(notes, minHz, maxHz, plotWidth, text => context.measureText(text).width)) {
          context.fillStyle = label.text === 'A4 440 Hz' ? color : muted;
          context.fillText(label.text, PAD.left + label.x, 10 + label.row * 17);
        }
        const data = frequencyFrame.current;
        if (data && analyser) {
          const binHz = analyser.context.sampleRate / analyser.fftSize;
          context.strokeStyle = color;
          context.lineWidth = 1.5;
          context.beginPath();
          for (let px = 0; px <= Math.ceil(plotWidth); px++) {
            const startHz = minHz * (maxHz / minHz) ** (px / plotWidth);
            const endHz = minHz * (maxHz / minHz) ** ((px + 1) / plotWidth);
            const first = Math.max(0, Math.min(data.length - 1, Math.round(startHz / binHz)));
            const last = Math.max(first, Math.min(data.length - 1, Math.ceil(endHz / binHz)));
            let value = 0;
            for (let bin = first; bin <= last; bin++) value = Math.max(value, data[bin]);
            const y = bottom - value / 255 * plotHeight;
            if (px === 0) context.moveTo(PAD.left, y); else context.lineTo(PAD.left + px, y);
          }
          context.stroke();
        }
        if (active && response) {
          context.strokeStyle = '#eab17c'; context.lineWidth = 2;
          context.beginPath();
          for (let px = 0; px <= Math.ceil(plotWidth); px++) {
            const hz = minHz * (maxHz / minHz) ** (px / plotWidth);
            const gain = responseAt(response, hz);
            const y = plotTop + (gainBounds.maximum - gain) / (gainBounds.maximum - gainBounds.minimum) * plotHeight;
            if (px === 0) context.moveTo(PAD.left, y); else context.lineTo(PAD.left + px, y);
          }
          context.stroke();
        }
        if (pointer.current !== null) {
          const x = Math.min(right, Math.max(PAD.left, pointer.current));
          context.strokeStyle = 'rgba(240,240,235,.55)'; context.setLineDash([3, 4]);
          context.beginPath(); context.moveTo(x, plotTop); context.lineTo(x, bottom); context.stroke();
          context.setLineDash([]);
        }
      } else {
        for (const value of [1, .5, 0, -.5, -1]) {
          const y = plotTop + (1 - value) / 2 * plotHeight;
          context.beginPath(); context.moveTo(PAD.left, y); context.lineTo(right, y); context.stroke();
          context.fillText(value.toFixed(1), 6, y);
        }
        const durationMs = analyser ? analyser.fftSize / analyser.context.sampleRate * 1000 : 0;
        for (let i = 0; i <= 4; i++) {
          const x = PAD.left + i / 4 * plotWidth;
          context.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
          context.fillText(`${Math.round(i / 4 * durationMs)} ms`, x, bottom + 22);
        }
        const data = waveFrame.current;
        if (data) {
          context.strokeStyle = color; context.lineWidth = 1.25; context.beginPath();
          for (let px = 0; px <= Math.ceil(plotWidth); px++) {
            const first = Math.min(data.length - 1, Math.floor(px / plotWidth * data.length));
            const last = Math.min(data.length - 1, Math.max(first, Math.ceil((px + 1) / plotWidth * data.length)));
            let low = 255, high = 0;
            for (let index = first; index <= last; index++) { low = Math.min(low, data[index]); high = Math.max(high, data[index]); }
            context.moveTo(PAD.left + px, plotTop + (1 - high / 255) * plotHeight);
            context.lineTo(PAD.left + px, plotTop + (1 - low / 255) * plotHeight);
          }
          context.stroke();
        }
      }
      if (active) frame = requestAnimationFrame(draw);
    };
    redraw.current = draw;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); draw(); });
    observer.observe(element);
    draw();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); redraw.current = () => {}; };
  }, [analyser, response, active, settings.mode, settings.fftSize, minHz, maxHz, notePreferences.enabled, notes]);

  const updatePointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (settings.mode !== 'spectrum') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const plotWidth = Math.max(1, rect.width - PAD.left - PAD.right);
    const x = Math.min(plotWidth, Math.max(0, event.clientX - rect.left - PAD.left));
    const hz = minHz * (maxHz / minHz) ** (x / plotWidth);
    const data = frequencyFrame.current;
    const bin = analyser ? Math.min((data?.length ?? 1) - 1, Math.round(hz * analyser.fftSize / analyser.context.sampleRate)) : 0;
    const db = data ? Math.round(-100 + (data[bin] ?? 0) / 255 * 80) : null;
    pointer.current = x + PAD.left;
    setReadout(`${Math.round(hz)} Hz · ${noteAt(hz)}${db === null ? '' : ` · ${db} dB`}`);
    if (!active) redraw.current();
  };
  const clearPointer = () => { pointer.current = null; setReadout(null); if (!active) redraw.current(); };
  const updateSettings = (change: Partial<ScopeSettings>) => {
    if (change.mode) { pointer.current = null; setReadout(null); }
    onSettingsChange({ ...settings, ...change });
  };
  const showEmpty = !analyser || (!active && !frameModes[settings.mode]);

  return <div className={`expanded-scope ${settings.mode === 'spectrum' ? 'has-note-controls' : ''}`} aria-label="扩展示波视图">
    <header className="scope-header"><div className="scope-track"><strong title={title}>{title}</strong><small title={artist}>{artist}</small></div><div className="scope-header-actions"><div className="scope-segments" aria-label="示波模式">{(['spectrum', 'waveform'] as const).map(mode => <button type="button" key={mode} aria-pressed={settings.mode === mode} onClick={() => updateSettings({ mode })}>{mode === 'spectrum' ? '频谱' : '波形'}</button>)}</div><button type="button" className="scope-close" onClick={onClose} aria-label="收起示波视图" title="收起示波视图"><Minimize2 size={17} /></button></div></header>
    <div className="scope-chart"><canvas ref={canvas} aria-label={settings.mode === 'spectrum' ? '实时频谱图' : '实时波形图'} onDoubleClick={onClose} onPointerMove={updatePointer} onPointerDown={updatePointer} onPointerLeave={clearPointer} onPointerUp={event => { if (event.pointerType !== 'mouse') clearPointer(); }} />{showEmpty && <div className="scope-empty">{analyser ? '等待音频播放' : '暂无音频分析数据'}</div>}</div>
    {settings.mode === 'spectrum' && <div className="scope-note-controls" role="group" aria-label="标准音阶标记">
      <label className="scope-note-toggle"><input type="checkbox" checked={notePreferences.enabled} onChange={event => setNotePreferences(previous => ({ ...previous, enabled: event.target.checked }))} />显示标准音阶</label>
      <label className="scope-note-count">标记数量 <input type="range" aria-label="音阶标记数量" min="4" max="128" step="1" value={notePreferences.count} disabled={!notePreferences.enabled} onChange={event => setNotePreferences(previous => ({ ...previous, count: Number(event.target.value) }))} /><output>最多 {notePreferences.count} 个</output></label>
      <small>{notePreferences.enabled ? `当前范围 ${notes.length} 个 · A4 = 440 Hz` : '已隐藏音阶标记'}</small>
    </div>}
    <div className="scope-readout" aria-live="off">{settings.mode === 'spectrum' ? <><span>{readout ? `指针位置 · ${readout}` : '—'}</span>{active && response && <span className="scope-filter-key">滤波响应 · dB</span>}</> : null}</div>
    <div className="scope-controls"><label>{settings.mode === 'spectrum' ? '精细度' : '采样窗口'}<select value={settings.fftSize} onChange={event => updateSettings({ fftSize: Number(event.target.value) as ScopeSettings['fftSize'] })}>{[2048, 4096, 8192, 16384].map(value => <option key={value} value={value}>{value} 点</option>)}</select></label>{settings.mode === 'spectrum' && <><div className="scope-range" role="group" aria-label="频谱横轴范围"><div className="scope-range-presets">{[{ label: '全域', from: 20, to: nyquist }, { label: '低频', from: 20, to: Math.min(1000, nyquist) }, { label: '中频', from: 200, to: Math.min(5000, nyquist) }, { label: '高频', from: Math.min(2000, nyquist - 20), to: nyquist }].filter(range => range.to - range.from >= 20).map(range => <button type="button" key={range.label} aria-pressed={minHz === range.from && maxHz === range.to} onClick={() => updateSettings({ minFrequency: range.from, maxFrequency: range.to })}>{range.label}</button>)}</div><label>起点 <input type="number" min="20" max={Math.floor(maxHz - 10)} step="10" value={minHz} onChange={event => updateSettings({ minFrequency: Math.max(20, Math.min(Number(event.target.value) || 20, maxHz - 10)) })} /> Hz</label><label>终点 <input type="number" min={Math.ceil(minHz + 10)} max={Math.floor(nyquist)} step="10" value={Math.round(maxHz)} onChange={event => updateSettings({ maxFrequency: Math.min(nyquist, Math.max(minHz + 10, Number(event.target.value) || nyquist)) })} /> Hz</label></div><label className="scope-smoothing">响应平滑度 <output>{Math.round(settings.smoothing * 100)}%</output><input type="range" min="0" max="0.95" step="0.05" value={settings.smoothing} onChange={event => updateSettings({ smoothing: Number(event.target.value) })} /></label></>}</div>
  </div>;
}
