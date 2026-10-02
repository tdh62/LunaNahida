import { Search, X } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { settingsCategories, type SettingsCategory } from '@/lib/settings-categories';

type SearchItem = { id: string; label: string; section: string; category: SettingsCategory; titleText: string; text: string };
type Props = { page: RefObject<HTMLDivElement | null>; active: SettingsCategory; onChange: (category: SettingsCategory) => void; hash: string };

export default function SettingsNavigation({ page, active, onChange, hash }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    if (!open || !page.current) return;
    const root = page.current;
    const update = () => {
      const next: SearchItem[] = [];
      root.querySelectorAll<HTMLElement>('.settings-group').forEach((section, index) => {
        section.id ||= `settings-section-${section.dataset.settingsCategory}-${section.querySelector('h2')?.textContent?.trim() ?? index}`;
        const category = section.dataset.settingsCategory as SettingsCategory;
        const title = section.querySelector('h2')?.textContent?.trim() ?? '设置';
        next.push({ id: section.id, label: title, section: '', category, titleText: title, text: `${title} ${section.textContent ?? ''}` });
        section.querySelectorAll<HTMLElement>('.settings-row, .lyric-setting-control, .settings-eq, form > label, .network-source-credentials > label, .backup-policy-controls > label').forEach((element, itemIndex) => {
          element.id ||= `${section.id}-item-${itemIndex}`;
          let label = element.querySelector('strong, label, .settings-eq-heading span')?.textContent?.trim()
            ?? Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
          if (/^\d+(\.\d+)?\s+(B|KB|MB|GB|TB)$/.test(label)) label = element.querySelector('button')?.textContent?.trim() ?? title;
          if (!label) return;
          const controlNames = Array.from(element.querySelectorAll('[aria-label]')).map(control => control.getAttribute('aria-label')).join(' ');
          const titleText = `${label} ${title} ${controlNames}`;
          next.push({ id: element.id, label, section: title, category, titleText, text: `${titleText} ${element.textContent ?? ''}` });
        });
      });
      setItems(next);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [open, page]);

  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    const section = target?.closest<HTMLElement>('.settings-group');
    if (!target || !section || !page.current?.contains(target)) return;
    onChange(section.dataset.settingsCategory as SettingsCategory);
    setTargetId(target.id);
  }, [hash, page, onChange]);

  useEffect(() => {
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target || target.closest('[hidden]')) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('settings-search-target');
    target.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => { target.classList.remove('settings-search-target'); setTargetId(''); }, 1800);
    return () => { window.clearTimeout(timer); target.classList.remove('settings-search-target'); };
  }, [active, targetId]);

  const select = (category: SettingsCategory) => {
    setTargetId('');
    onChange(category);
    page.current?.closest('.settings-workspace')?.scrollTo({ top: 0, behavior: 'instant' });
    if (window.matchMedia('(max-width: 760px)').matches) page.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const words = query.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every(word => text.normalize('NFKC').toLocaleLowerCase().includes(word));
  const results = items.filter(item => words.length ? matches(item.text) : !item.section).sort((a, b) => Number(matches(b.titleText)) - Number(matches(a.titleText)));

  return <div className="settings-navigation">
    <div className="settings-category-tabs" role="tablist" aria-label="设置分类">
      {settingsCategories.map((category, index) => <button type="button" role="tab" id={`settings-tab-${category.id}`} aria-controls="settings-content" aria-selected={active === category.id} tabIndex={active === category.id ? 0 : -1} key={category.id} onClick={() => select(category.id)} onKeyDown={event => {
        let next: number;
        if (event.key === 'ArrowRight') next = (index + 1) % settingsCategories.length;
        else if (event.key === 'ArrowLeft') next = (index + settingsCategories.length - 1) % settingsCategories.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = settingsCategories.length - 1;
        else return;
        event.preventDefault();
        select(settingsCategories[next].id);
        document.getElementById(`settings-tab-${settingsCategories[next].id}`)?.focus();
      }}>{category.label}</button>)}
    </div>
    <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(''); }}>
      <PopoverTrigger asChild><button type="button" className="settings-search-trigger" aria-label="搜索设置"><Search size={16} /><span>搜索</span></button></PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={{ top: 40, bottom: 136, left: 12, right: 12 }} className="settings-search-popover" aria-label="搜索设置" onCloseAutoFocus={event => { if (targetId) event.preventDefault(); }}>
        <div className="settings-floating-search"><Search size={17} /><input type="search" aria-label="搜索设置" placeholder="搜索设置项" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || !['Enter', 'ArrowDown'].includes(event.key)) return;
          const result = event.currentTarget.closest('.settings-search-popover')?.querySelector<HTMLButtonElement>('.settings-search-results button');
          if (!result) return;
          event.preventDefault();
          if (event.key === 'Enter') result.click(); else result.focus();
        }} />{query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}</div>
        <div className="settings-search-results">{results.map((item, index) => <button type="button" key={item.id} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button');
          buttons?.[(index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length]?.focus();
        }} onClick={() => { select(item.category); setTargetId(item.id); setOpen(false); setQuery(''); }}><span>{item.label}</span><small>{settingsCategories.find(category => category.id === item.category)?.label}{item.section && ` · ${item.section}`}</small></button>)}{!results.length && <p role="status">没有找到相关设置</p>}</div>
      </PopoverContent>
    </Popover>
  </div>;
}
