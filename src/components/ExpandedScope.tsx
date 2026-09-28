import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Minimize2 } from 'lucide-react';
import type { ScopeSettings } from '@/lib/backend';
import { detectSampleRate } from '@/lib/audio-sample-rate';
import { responseAt, type FrequencyResponse } from '@/lib/audio-filter';

type Props = {
  analyser: AnalyserNode | null;
  response: FrequencyResponse | null;
  active: boolean;
  trackId: number | null;
  title: string;
  artist: string;
  sampleRate?: number;
  settings: ScopeSettings;
  onSettingsChange: (settings: ScopeSettings) => void;
  onClose: () => void;
};

const PAD = { left: 48, right: 46, top: 22, bottom: 36 };
const hzMarks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function formatHz(value: number) {
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : `${Math.round(value)}`;
}

function noteAt(frequency: number) {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const reference = 440 * 2 ** ((midi - 69) / 12);
  const cents = Math.round(1200 * Math.log2(frequency / reference));
  return `${noteNames[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1} ${cents >= 0 ? '+' : ''}${cents} 音分`;
}

export default function ExpandedScope({ analyser, response, active, trackId, title, artist, sampleRate, settings, onSettingsChange, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<() => void>(() => {});
  const pointer = useRef<number | null>(null);
  const frequencyFrame = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const waveFrame = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [frameModes, setFrameModes] = useState({ spectrum: false, waveform: false });
  const [readout, setReadout] = useState<string | null>(null);
  const [detectedRate, setDetectedRate] = useState<number | null>(null);
  const nyquist = Math.floor(Math.max(100, Math.min((sampleRate || detectedRate || analyser?.context.sampleRate || 44100) / 2, (analyser?.context.sampleRate || sampleRate || detectedRate || 44100) / 2)));
  const minHz = Math.max(20, Math.min(settings.minFrequency || 20, nyquist - 20));
  const maxHz = Math.max(minHz + 10, Math.min(settings.maxFrequency, nyquist));

  useEffect(() => {
    frequencyFrame.current = null;
    waveFrame.current = null;
    pointer.current = null;
    setFrameModes({ spectrum: false, waveform: false });
    setReadout(null);
  }, [trackId]);

  useEffect(() => {
    setDetectedRate(null);
    if (sampleRate || trackId === null) return;
    const controller = new AbortController();
    void fetch(`/api/media/audio/${trackId}`, { headers: { Range: 'bytes=0-262143' }, signal: controller.signal })
      .then(async response => response.status === 206 ? detectSampleRate(new Uint8Array(await response.arrayBuffer())) : null)
      .then(rate => { if (!controller.signal.aborted) setDetectedRate(rate); })
      .catch(() => {});
    return () => controller.abort();
  }, [trackId, sampleRate]);

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
      const plotWidth = Math.max(1, width - PAD.left - PAD.right);
      const plotHeight = Math.max(1, height - PAD.top - PAD.bottom);
      const right = PAD.left + plotWidth, bottom = PAD.top + plotHeight;
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
          const y = PAD.top + (-20 - db) / 80 * plotHeight;
          context.beginPath(); context.moveTo(PAD.left, y); context.lineTo(right, y); context.stroke();
          context.fillText(`${db}`, 5, y);
        }
        if (active && response) {
          context.save();
          context.strokeStyle = 'rgba(234,177,124,.55)';
          context.fillStyle = '#eab17c';
          context.textAlign = 'left';
          context.setLineDash([3, 5]);
          const zeroY = PAD.top + plotHeight / 3;
          context.beginPath(); context.moveTo(PAD.left, zeroY); context.lineTo(right, zeroY); context.stroke();
          context.setLineDash([]);
          for (const gain of [24, 0, -24, -48]) {
            const y = PAD.top + (24 - gain) / 72 * plotHeight;
            context.fillText(`${gain > 0 ? '+' : ''}${gain}`, right + 5, y);
          }
          context.restore();
        }
        for (const hz of hzMarks) {
          if (hz < minHz || hz > maxHz) continue;
          const x = xAt(hz);
          context.beginPath(); context.moveTo(x, PAD.top); context.lineTo(x, bottom); context.stroke();
          if (x - PAD.left > 30 && right - x > 30) { context.textAlign = 'center'; context.fillText(formatHz(hz), x, bottom + 22); }
        }
        context.textAlign = 'left'; context.fillText(formatHz(minHz), PAD.left, bottom + 22);
        context.textAlign = 'right'; context.fillText(formatHz(maxHz), right, bottom + 22);
        let lastLabel = -100;
        for (let octave = 0; octave <= 9; octave++) {
          const hz = 440 * 2 ** (((octave + 1) * 12 - 69) / 12);
          if (hz < minHz || hz > maxHz) continue;
          const x = xAt(hz);
          if (x - lastLabel < 43) continue;
          context.strokeStyle = 'rgba(160,180,160,.35)';
          context.beginPath(); context.moveTo(x, PAD.top); context.lineTo(x, bottom); context.stroke();
          context.textAlign = 'center'; context.fillStyle = muted;
          context.fillText(`C${octave}`, x, 10);
          lastLabel = x;
        }
        if (440 >= minHz && 440 <= maxHz) {
          const x = xAt(440);
          context.strokeStyle = color;
          context.setLineDash([4, 4]);
          context.beginPath(); context.moveTo(x, PAD.top); context.lineTo(x, bottom); context.stroke();
          context.setLineDash([]);
          context.fillStyle = color; context.textAlign = 'center';
          context.fillText('A4 440 Hz', Math.min(right - 40, Math.max(PAD.left + 40, x)), 10);
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
            const y = PAD.top + (24 - Math.max(-48, Math.min(24, gain))) / 72 * plotHeight;
            if (px === 0) context.moveTo(PAD.left, y); else context.lineTo(PAD.left + px, y);
          }
          context.stroke();
        }
        if (pointer.current !== null) {
          const x = Math.min(right, Math.max(PAD.left, pointer.current));
          context.strokeStyle = 'rgba(240,240,235,.55)'; context.setLineDash([3, 4]);
          context.beginPath(); context.moveTo(x, PAD.top); context.lineTo(x, bottom); context.stroke();
          context.setLineDash([]);
        }
      } else {
        for (const value of [1, .5, 0, -.5, -1]) {
          const y = PAD.top + (1 - value) / 2 * plotHeight;
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
            context.moveTo(PAD.left + px, PAD.top + (1 - high / 255) * plotHeight);
            context.lineTo(PAD.left + px, PAD.top + (1 - low / 255) * plotHeight);
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
  }, [analyser, response, active, settings.mode, settings.fftSize, minHz, maxHz]);

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

  return <div className="expanded-scope" aria-label="扩展示波视图">
    <header className="scope-header"><div className="scope-track"><span>实时音频分析</span><strong title={title}>{title}</strong><small title={artist}>{artist}</small></div><div className="scope-header-actions"><div className="scope-segments" aria-label="示波模式">{(['spectrum', 'waveform'] as const).map(mode => <button type="button" key={mode} aria-pressed={settings.mode === mode} onClick={() => updateSettings({ mode })}>{mode === 'spectrum' ? '频谱' : '波形'}</button>)}</div><button type="button" className="scope-close" onClick={onClose} aria-label="收起示波视图" title="收起示波视图"><Minimize2 size={17} /></button></div></header>
    <div className="scope-chart"><canvas ref={canvas} aria-label={settings.mode === 'spectrum' ? '实时频谱图' : '实时波形图'} onPointerMove={updatePointer} onPointerDown={updatePointer} onPointerLeave={clearPointer} onPointerUp={event => { if (event.pointerType !== 'mouse') clearPointer(); }} />{showEmpty && <div className="scope-empty">{analyser ? '等待音频播放' : '暂无音频分析数据'}</div>}</div>
    <div className="scope-readout" aria-live="off">{settings.mode === 'spectrum' ? <><span>{readout ? `指针位置 · ${readout}` : '指针位置 · 移至频谱查看频率和标准音符'}</span>{active && response && <span className="scope-filter-key">频率 FIR 频响 · 右轴 dB</span>}</> : '实时振幅 · 时间窗口'}</div>
    <div className="scope-controls"><label>{settings.mode === 'spectrum' ? '精细度' : '采样窗口'}<select value={settings.fftSize} onChange={event => updateSettings({ fftSize: Number(event.target.value) as ScopeSettings['fftSize'] })}>{[2048, 4096, 8192, 16384].map(value => <option key={value} value={value}>{value} 点</option>)}</select></label>{settings.mode === 'spectrum' && <><div className="scope-range" role="group" aria-label="频谱横轴范围"><div className="scope-range-presets">{[{ label: '全域', from: 20, to: nyquist }, { label: '低频', from: 20, to: Math.min(1000, nyquist) }, { label: '中频', from: 200, to: Math.min(5000, nyquist) }, { label: '高频', from: Math.min(2000, nyquist - 20), to: nyquist }].filter(range => range.to - range.from >= 20).map(range => <button type="button" key={range.label} aria-pressed={minHz === range.from && maxHz === range.to} onClick={() => updateSettings({ minFrequency: range.from, maxFrequency: range.to })}>{range.label}</button>)}</div><label>起点 <input type="number" min="20" max={Math.floor(maxHz - 10)} step="10" value={minHz} onChange={event => updateSettings({ minFrequency: Math.max(20, Math.min(Number(event.target.value) || 20, maxHz - 10)) })} /> Hz</label><label>终点 <input type="number" min={Math.ceil(minHz + 10)} max={Math.floor(nyquist)} step="10" value={Math.round(maxHz)} onChange={event => updateSettings({ maxFrequency: Math.min(nyquist, Math.max(minHz + 10, Number(event.target.value) || nyquist)) })} /> Hz</label></div><label className="scope-smoothing">响应平滑度 <output>{Math.round(settings.smoothing * 100)}%</output><input type="range" min="0" max="0.95" step="0.05" value={settings.smoothing} onChange={event => updateSettings({ smoothing: Number(event.target.value) })} /></label></>}</div>
  </div>;
}
