import { Pause, Play, Square, Volume2 } from 'lucide-react';
import type { NoiseType } from '@/lib/noise-player';
import type { NoiseControls } from '@/hooks/use-noise-generator';

const noises: { type: NoiseType; name: string }[] = [
  { type: 'white', name: '白噪音' },
  { type: 'pink', name: '粉红噪音' },
  { type: 'brown', name: '褐噪音' },
];

export default function NoiseGenerator({ noise }: { noise: NoiseControls }) {
  const { type, volume, status, error, changeType } = noise;
  return <section className="noise-generator" aria-label="噪音发生器">
    <div className="noise-types" role="group" aria-label="噪音类型">{noises.map(noise => <button type="button" key={noise.type} aria-pressed={type === noise.type} className={type === noise.type ? 'active' : ''} onClick={() => changeType(noise.type)}><strong>{noise.name}</strong></button>)}</div>
    <label className="noise-volume"><span><Volume2 size={16} /> 噪音音量 <output>{volume}%</output></span><input type="range" min="0" max="100" step="1" value={volume} aria-label="噪音音量" onChange={event => noise.setVolume(Number(event.target.value))} /></label>
    <p className="noise-safety">音乐暂停，播放列表保留；关闭窗口后继续播放噪音。</p>
    <div className="noise-status" role="status" aria-live="polite"><i className={status === 'playing' ? 'active' : ''} />{status === 'playing' ? `正在播放${noise.name}` : status === 'starting' ? '正在准备声音…' : status === 'paused' ? `${noise.name}已暂停` : '噪音已停止'}</div>
    {error && <p className="noise-error" role="alert">{error}</p>}
    <div className="toolbox-actions">{noise.active && <button type="button" onClick={noise.stop}><Square size={15} />停止噪音</button>}<button type="button" className="toolbox-convert" onClick={noise.toggle}>{noise.playing ? <><Pause size={15} />暂停噪音</> : <><Play size={15} />{status === 'paused' ? '继续噪音' : '播放噪音'}</>}</button></div>
  </section>;
}
