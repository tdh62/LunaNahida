import { useEffect, useState } from 'react';
import { retainPage } from '@/lib/page-cache';

export function useRetainedPages(route: string, backend: boolean, ready: boolean) {
  const [pages, setPages] = useState(() => retainPage(['/'], route));
  if (!pages.includes(route)) setPages(previous => retainPage(previous, route));
  useEffect(() => {
    if (!backend || !ready) return;
    const warm = () => setPages(previous => retainPage(retainPage(previous, '/playlists'), '/music'));
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 200);
    return () => window.clearTimeout(id);
  }, [backend, ready]);
  // Refresh recency only for actual navigation, not progress or other state changes.
  useEffect(() => { setPages(previous => retainPage(previous, route)); }, [route]);
  return pages.includes(route) ? pages : retainPage(pages, route);
}
