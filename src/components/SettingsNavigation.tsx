import { useLayoutEffect, useState, type RefObject } from 'react';

export default function SettingsNavigation({ page }: { page: RefObject<HTMLDivElement | null> }) {
  const [query, setQuery] = useState('');
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  useLayoutEffect(() => {
    const root = page.current;
    if (!root) return;
    const update = () => {
      const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const visible: { id: string; title: string }[] = [];
      root.querySelectorAll<HTMLElement>('.settings-group').forEach((section, index) => {
        section.id ||= `settings-section-${index}`;
        const text = (section.textContent ?? '').toLocaleLowerCase();
        section.hidden = !words.every(word => text.includes(word));
        if (!section.hidden) visible.push({ id: section.id, title: section.querySelector('h2')?.textContent ?? '设置' });
      });
      setSections(previous => JSON.stringify(previous) === JSON.stringify(visible) ? previous : visible);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [page, query]);
  return <div className="settings-navigation">
    <label>搜索设置<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：歌词、备份、网络" /></label>
    {query && <button type="button" onClick={() => setQuery('')}>清除搜索</button>}
    <nav aria-label="设置分类">{sections.map(section => <button type="button" key={section.id} onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>{section.title}</button>)}</nav>
    {!sections.length && <p role="status">没有找到相关设置</p>}
  </div>;
}
