import { Check, Headphones, Leaf, Moon, Palette, SlidersHorizontal, Sparkles, Timer, Waves } from 'lucide-react';
import { formatTime } from '@/lib/music';

export const themes = [
  { id: 'dusk', name: '山间暮色', desc: '柔和的暮蓝', icon: Moon },
  { id: 'anime', name: '星野放映室', desc: '轻盈的粉色', icon: Sparkles },
  { id: 'forest', name: '森林呼吸', desc: '安静的绿意', icon: Leaf },
];

const eqNames = ['低音', '低中', '中音', '高中', '高音'];

type SettingsProps = {
  theme: string;
  setTheme: (value: string) => void;
  visual: string;
  setVisual: (value: string) => void;
  lyricEffect: string;
  setLyricEffect: (value: string) => void;
  showTranslation: boolean;
  setShowTranslation: (value: boolean) => void;
  sleep: number;
  setSleep: (value: number) => void;
  effect: string;
  setEffect: (value: string) => void;
  equalizer: number[];
  setBand: (index: number, value: number) => void;
  resetEqualizer: () => void;
};

export default function PlayerSettings({ theme, setTheme, visual, setVisual, lyricEffect, setLyricEffect, showTranslation, setShowTranslation, sleep, setSleep, effect, setEffect, equalizer, setBand, resetEqualizer }: SettingsProps) {
  return <div className="settings-page">
    <header className="settings-heading"><span>PERSONALIZE YOUR SPACE</span><h1>设置</h1><p>调整你喜欢的播放体验。</p></header>
    <section className="settings-group"><div className="settings-group-title"><Palette size={19} /><div><h2>界面主题</h2><p>颜色只影响界面，不会改变正在播放的音乐。</p></div></div>
      <div className="settings-themes">{themes.map(t => <button type="button" key={t.id} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} className={`settings-theme ${theme === t.id ? 'selected' : ''}`}><span className={`settings-theme-preview preview-${t.id}`}><t.icon size={24} /></span><span className="settings-theme-label"><strong><t.icon size={15} /> {t.name}</strong><small>{t.desc}</small></span><span className="settings-theme-check">{theme === t.id && <Check size={15} />}</span></button>)}</div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Headphones size={19} /><div><h2>播放器样式</h2><p>选择封面动画和歌词呈现方式。</p></div></div>
      <div className="settings-row"><div><strong>播放氛围</strong><small>切换封面与频谱显示</small></div><div className="settings-options">{['频谱', '唱片', '呼吸'].map(v => <button key={v} aria-pressed={visual === v} className={visual === v ? 'active' : ''} onClick={() => setVisual(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词效果</strong><small>调整正在播放的歌词样式</small></div><div className="settings-options">{['流动', '聚焦', '逐字'].map(v => <button key={v} aria-pressed={lyricEffect === v} className={lyricEffect === v ? 'active' : ''} onClick={() => setLyricEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>显示翻译</strong><small>在当前歌词下显示译文</small></div><button type="button" role="switch" aria-checked={showTranslation} aria-label="显示翻译" onClick={() => setShowTranslation(!showTranslation)} className={`settings-switch ${showTranslation ? 'on' : ''}`}><span /></button></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><SlidersHorizontal size={19} /><div><h2>声音</h2><p>让每首歌听起来更合心意。</p></div></div>
      <div className="settings-row"><div><strong>音效</strong><small>应用到当前和之后播放的曲目</small></div><div className="settings-options settings-wrap">{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(v => <button key={v} aria-pressed={effect === v} className={effect === v ? 'active' : ''} onClick={() => setEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-eq"><div className="settings-eq-heading"><span><Waves size={16} /> 五段均衡器</span><button onClick={resetEqualizer}>重置</button></div><div className="settings-eq-grid">{eqNames.map((name, i) => <label key={name}><span>{name}</span><input type="range" min="-12" max="12" value={equalizer[i]} onChange={e => setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{equalizer[i] > 0 ? '+' : ''}{equalizer[i]} dB</small></label>)}</div></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Timer size={19} /><div><h2>睡眠定时</h2><p>到时间后自动暂停音乐。</p></div></div><div className="settings-row"><div><strong>暂停时间</strong><small>{sleep > 0 ? `剩余 ${formatTime(sleep)}` : '未设置定时'}</small></div><div className="settings-options">{[0, 15, 30, 60].map(v => <button key={v} aria-pressed={v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v} className={(v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v) ? 'active' : ''} onClick={() => setSleep(v * 60)}>{v ? `${v} 分钟` : '关闭'}</button>)}</div></div></section>
  </div>;
}
