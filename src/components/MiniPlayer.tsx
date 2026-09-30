import type { CSSProperties, ReactNode } from 'react';
import { Maximize2, Minus, Pause, Pin, PinOff, Play, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTime } from '@/lib/music';

export function MiniModeButton({ label, children, onClick, disabled = false, pressed, className = '' }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; className?: string }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" className={`mini-mode-button ${className}`} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button></TooltipTrigger><TooltipContent side="bottom" collisionPadding={8}>{label}</TooltipContent></Tooltip>;
}

type MiniPlayerProps = {
  title: string; artist: string; cover: string; playing: boolean; available: boolean;
  noise: boolean; time: number; duration: number; volume: number; busy: boolean; pinned: boolean;
  onRestore: () => void; onPin: () => void; onMinimise: () => void; onClose: () => void;
  onToggle: () => void; onPrevious: () => void; onNext: () => void; onSeek: (time: number) => void;
  onVolume: (volume: number) => void; onStopNoise: () => void;
};

export default function MiniPlayer(p: MiniPlayerProps) {
  return <section className="desktop-mini-player" aria-label="迷你播放器" data-file-drop-target>
    <header className="mini-window-header"><span>LunaNahida</span><div>
      <MiniModeButton label={p.pinned ? '取消置顶' : '窗口置顶'} pressed={p.pinned} disabled={p.busy} onClick={p.onPin}>{p.pinned ? <PinOff size={14} /> : <Pin size={14} />}</MiniModeButton>
      <MiniModeButton label="退出迷你模式" disabled={p.busy} onClick={p.onRestore}><Maximize2 size={14} /></MiniModeButton>
      <MiniModeButton label="最小化窗口" disabled={p.busy} onClick={p.onMinimise}><Minus size={15} /></MiniModeButton>
      <MiniModeButton label="关闭窗口" className="mini-close" disabled={p.busy} onClick={p.onClose}><X size={15} /></MiniModeButton>
    </div></header>
    <div className="mini-now-playing"><img src={p.cover} alt="" /><div><strong title={p.title}>{p.title}</strong><small title={p.artist}>{p.artist}</small></div></div>
    <div className="mini-progress"><span>{p.noise ? '--:--' : formatTime(p.time)}</span><input type="range" aria-label="播放进度" min="0" max={Math.max(1, p.duration)} step="0.1" value={p.noise ? 0 : p.time} disabled={!p.available || p.noise} onChange={event => p.onSeek(Number(event.target.value))} style={{ '--fill': `${p.noise ? 0 : p.time / Math.max(1, p.duration) * 100}%` } as CSSProperties} /><span>{p.noise ? '--:--' : formatTime(p.duration)}</span></div>
    <div className="mini-controls"><div className="mini-transport">
      <MiniModeButton label="上一首" disabled={!p.available || p.noise} onClick={p.onPrevious}><SkipBack size={17} fill="currentColor" /></MiniModeButton>
      <MiniModeButton label={p.playing ? '暂停' : '播放'} className="mini-play" disabled={!p.available} onClick={p.onToggle}>{p.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</MiniModeButton>
      <MiniModeButton label="下一首" disabled={!p.available || p.noise} onClick={p.onNext}><SkipForward size={17} fill="currentColor" /></MiniModeButton>
      {p.noise && <MiniModeButton label="停止噪音" onClick={p.onStopNoise}><Square size={15} /></MiniModeButton>}
    </div><div className="mini-volume"><MiniModeButton label={p.volume ? '静音' : '恢复音量'} onClick={() => p.onVolume(p.volume ? 0 : p.noise ? 20 : 65)}>{p.volume ? <Volume2 size={16} /> : <VolumeX size={16} />}</MiniModeButton><input type="range" aria-label="音量" min="0" max="100" value={p.volume} onChange={event => p.onVolume(Number(event.target.value))} style={{ '--fill': `${p.volume}%` } as CSSProperties} /></div></div>
  </section>;
}
