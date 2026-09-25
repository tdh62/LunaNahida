import { Check, Headphones, Leaf, Moon, Palette, Pencil, Plus, SlidersHorizontal, Sparkles, Timer, Trash2, Users, Waves } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { normalizeName, type ArtistMapping } from '@/lib/catalog';
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
  lyricScroll: string;
  setLyricScroll: (value: string) => void;
  showTranslation: boolean;
  setShowTranslation: (value: boolean) => void;
  sleep: number;
  setSleep: (value: number) => void;
  effect: string;
  setEffect: (value: string) => void;
  equalizer: number[];
  setBand: (index: number, value: number) => void;
  resetEqualizer: () => void;
  mappings: ArtistMapping[];
  setMappings: (mappings: ArtistMapping[]) => void;
  artistNames: string[];
};

export default function PlayerSettings({ theme, setTheme, visual, setVisual, lyricEffect, setLyricEffect, lyricScroll, setLyricScroll, showTranslation, setShowTranslation, sleep, setSleep, effect, setEffect, equalizer, setBand, resetEqualizer, mappings, setMappings, artistNames }: SettingsProps) {
  const [root, setRoot] = useState('');
  const [aliases, setAliases] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState('');
  const saveMapping = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = root.trim();
    const names = [...new Map(aliases.split(/[,，、\n]+/).map(value => value.trim()).filter(Boolean).map(value => [normalizeName(value), value])).values()].filter(value => normalizeName(value) !== normalizeName(name));
    if (!name || !names.length) { setError('请填写根名称和至少一个不同的名称'); return; }
    const keys = [name, ...names].map(normalizeName);
    if (mappings.some((item, index) => index !== editing && [item.root, ...item.aliases].some(value => keys.includes(normalizeName(value))))) { setError('名称已属于其他映射组'); return; }
    const updated = { root: name, aliases: names };
    setMappings(editing === null ? [...mappings, updated] : mappings.map((item, index) => index === editing ? updated : item));
    setRoot(''); setAliases(''); setEditing(null); setError('');
  };
  return <div className="settings-page">
    <header className="settings-heading"><h1>设置</h1></header>
    <section className="settings-group"><div className="settings-group-title"><Palette size={19} /><div><h2>界面主题</h2><p>颜色只影响界面，不会改变正在播放的音乐。</p></div></div>
      <div className="settings-themes">{themes.map(t => <button type="button" key={t.id} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)} className={`settings-theme ${theme === t.id ? 'selected' : ''}`}><span className={`settings-theme-preview preview-${t.id}`}><t.icon size={24} /></span><span className="settings-theme-label"><strong><t.icon size={15} /> {t.name}</strong><small>{t.desc}</small></span><span className="settings-theme-check">{theme === t.id && <Check size={15} />}</span></button>)}</div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Headphones size={19} /><div><h2>播放器样式</h2><p>选择封面动画和歌词呈现方式。</p></div></div>
      <div className="settings-row"><div><strong>播放氛围</strong><small>切换封面与频谱显示</small></div><div className="settings-options">{['频谱', '唱片', '呼吸'].map(v => <button key={v} aria-pressed={visual === v} className={visual === v ? 'active' : ''} onClick={() => setVisual(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词效果</strong><small>调整正在播放的歌词样式</small></div><div className="settings-options">{['流动', '聚焦', '逐字'].map(v => <button key={v} aria-pressed={lyricEffect === v} className={lyricEffect === v ? 'active' : ''} onClick={() => setLyricEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>歌词滚动</strong><small>切换歌词跟随播放的过渡方式</small></div><div className="settings-options">{['平滑', '即时'].map(v => <button key={v} aria-pressed={lyricScroll === v} className={lyricScroll === v ? 'active' : ''} onClick={() => setLyricScroll(v)}>{v}</button>)}</div></div>
      <div className="settings-row"><div><strong>显示翻译</strong><small>在当前歌词下显示译文</small></div><button type="button" role="switch" aria-checked={showTranslation} aria-label="显示翻译" onClick={() => setShowTranslation(!showTranslation)} className={`settings-switch ${showTranslation ? 'on' : ''}`}><span /></button></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><SlidersHorizontal size={19} /><div><h2>声音</h2></div></div>
      <div className="settings-row"><div><strong>音效</strong></div><div className="settings-options settings-wrap">{['原声', '低音增强', '空间回响', '温暖 Lo-fi'].map(v => <button key={v} aria-pressed={effect === v} className={effect === v ? 'active' : ''} onClick={() => setEffect(v)}>{v}</button>)}</div></div>
      <div className="settings-eq"><div className="settings-eq-heading"><span><Waves size={16} /> 五段均衡器</span><button onClick={resetEqualizer}>重置</button></div><div className="settings-eq-grid">{eqNames.map((name, i) => <label key={name}><span>{name}</span><input type="range" min="-12" max="12" value={equalizer[i]} onChange={e => setBand(i, Number(e.target.value))} aria-label={`${name}频段`} /><small>{equalizer[i] > 0 ? '+' : ''}{equalizer[i]} dB</small></label>)}</div></div>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Users size={19} /><div><h2>歌手名称映射</h2><p>繁简体名称自动合并；手动指定根名称后，歌手页将显示根名称。</p></div></div>
      {mappings.length > 0 && <div className="artist-mapping-list">{mappings.map((item, index) => <div className="artist-mapping-item" key={index}><div><strong>{item.root}</strong><small>{item.aliases.join(' · ')}</small></div><button type="button" aria-label={`编辑 ${item.root}`} title="编辑映射" onClick={() => { setRoot(item.root); setAliases(item.aliases.join('，')); setEditing(index); setError(''); }}><Pencil size={15} /></button><button type="button" aria-label={`删除 ${item.root}`} title="删除映射" onClick={() => { setMappings(mappings.filter((_, i) => i !== index)); if (editing === index) { setEditing(null); setRoot(''); setAliases(''); setError(''); } else if (editing !== null && editing > index) setEditing(editing - 1); }}><Trash2 size={15} /></button></div>)}</div>}
      <form className="artist-mapping-form" onSubmit={saveMapping}><label>展示名称（映射根）<input value={root} onChange={event => setRoot(event.target.value)} placeholder="例如：青木" list="artist-name-options" maxLength={80} /></label><label>其他名称（用逗号分隔）<input value={aliases} onChange={event => setAliases(event.target.value)} placeholder="例如：青木 · Aoki，青木 Aoki" maxLength={500} /></label><datalist id="artist-name-options">{artistNames.map(name => <option key={name} value={name} />)}</datalist>{error && <p role="alert">{error}</p>}<div><button type="submit" className="playlist-primary"><Plus size={15} />{editing === null ? '添加映射' : '保存映射'}</button>{editing !== null && <button type="button" className="artist-mapping-cancel" onClick={() => { setEditing(null); setRoot(''); setAliases(''); setError(''); }}>取消</button>}</div></form>
    </section>
    <section className="settings-group"><div className="settings-group-title"><Timer size={19} /><div><h2>睡眠定时</h2><p>到时间后自动暂停音乐。</p></div></div><div className="settings-row"><div><strong>暂停时间</strong><small>{sleep > 0 ? `剩余 ${formatTime(sleep)}` : '未设置定时'}</small></div><div className="settings-options">{[0, 15, 30, 60].map(v => <button key={v} aria-pressed={v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v} className={(v === 0 ? sleep === 0 : sleep > 0 && Math.ceil(sleep / 60) === v) ? 'active' : ''} onClick={() => setSleep(v * 60)}>{v ? `${v} 分钟` : '关闭'}</button>)}</div></div></section>
  </div>;
}
