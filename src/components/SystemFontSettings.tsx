import { ArrowDown, ArrowUp, Plus, Search, Trash2, Type } from 'lucide-react';
import { useEffect, useState } from 'react';
import { backend } from '@/lib/backend';
import { uiFontStack } from '@/lib/ui-fonts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import LoadingPlaceholder from './LoadingPlaceholder';

type Props = { hidden: boolean; families: string[]; onChange: (families: string[]) => void };

export default function SystemFontSettings({ hidden, families, onChange }: Props) {
  const [picker, setPicker] = useState<number | null>(null);
  const [fonts, setFonts] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const open = picker !== null;
  useEffect(() => {
    if (!open || fonts) return;
    let active = true;
    setError('');
    void backend.systemFonts().then(value => {
      if (active) setFonts(value.sort((a, b) => a.localeCompare(b)));
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : '无法读取系统字体');
    });
    return () => { active = false; };
  }, [open, fonts, attempt]);
  const choose = (index: number) => { setSearch(''); setPicker(index); };
  const move = (index: number, offset: number) => {
    const next = [...families];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  const select = (family: string) => {
    if (picker === null) return;
    const next = [...families];
    next[picker] = family;
    onChange(next);
    setPicker(null);
  };
  const available = fonts?.filter(font => font.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="settings-group system-font-settings" data-settings-category="appearance" hidden={hidden}>
    <div className="settings-group-title"><Type size={19} /><div><h2>界面字体</h2></div></div>
    <p className="system-font-hint">西文字体放在前面，缺少的字符由后续字体补充。</p>
    <div className="system-font-stack">{families.map((family, index) => <div className="system-font-row" key={`${index}-${family}`}>
      <span className="system-font-order">{index + 1}</span>
      <button type="button" className="system-font-choice" aria-label={`选择第 ${index + 1} 个字体`} onClick={() => choose(index)} style={{ fontFamily: uiFontStack([family]) }}>{family}</button>
      <div className="system-font-actions">
        <button type="button" aria-label={`上移 ${family}`} title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
        <button type="button" aria-label={`下移 ${family}`} title="下移" disabled={index === families.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
        <button type="button" aria-label={`移除 ${family}`} title="移除" onClick={() => onChange(families.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
      </div>
    </div>)}</div>
    <div className="system-font-footer">
      <button type="button" className="playlist-primary" disabled={families.length >= 8} onClick={() => choose(families.length)}><Plus size={15} />添加字体</button>
      {families.length > 0 && <button type="button" className="playlist-primary" onClick={() => onChange([])}>恢复默认</button>}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!value) setPicker(null); }}>
      <DialogContent className="system-font-dialog">
        <DialogTitle>选择系统字体</DialogTitle>
        <DialogDescription className="sr-only">按名称搜索并选择已安装的字体。</DialogDescription>
        <label className="settings-floating-search"><Search size={16} /><input type="search" aria-label="搜索系统字体" placeholder="搜索字体" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="system-font-results">
          {error ? <div role="alert"><p>{error}</p><button type="button" className="playlist-primary" onClick={() => setAttempt(value => value + 1)}>重试</button></div>
            : !fonts ? <LoadingPlaceholder label="正在读取系统字体…" kind="list" rows={5} />
            : !available?.length ? <p role="status">未找到字体</p>
            : available.map(font => <button type="button" key={font} disabled={families.some((family, i) => family === font && i !== picker)} onClick={() => select(font)} style={{ fontFamily: uiFontStack([font]) }}>{font}</button>)}
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
