import { useCallback, useLayoutEffect, type RefObject } from 'react';

export type CatalogListState = {
  search: string;
  sort: 'added' | 'name' | 'tracks' | 'year' | 'artist';
  scrollTop: number;
};

function scrollContainer(page: HTMLElement) {
  return window.matchMedia('(max-width: 760px)').matches
    ? document.scrollingElement as HTMLElement | null
    : page.closest<HTMLElement>('.catalog-workspace');
}

export function useCatalogListScroll(page: RefObject<HTMLElement | null>, state: CatalogListState, detailKey: string) {
  const rememberListPosition = useCallback(() => {
    if (detailKey || !page.current) return;
    const container = scrollContainer(page.current);
    if (container) state.scrollTop = container.scrollTop;
  }, [page, state, detailKey]);

  useLayoutEffect(() => {
    const element = page.current;
    const container = element && scrollContainer(element);
    if (!element || !container) return;
    if (detailKey) {
      container.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const events = container === document.scrollingElement ? window : container;
    const requested = state.scrollTop;
    let pending = true;
    const restore = () => {
      if (!pending) return;
      container.scrollTo({ top: requested, behavior: 'instant' });
      pending = container.scrollTop < requested - 1;
    };
    const remember = () => { if (!pending) state.scrollTop = container.scrollTop; };
    const interrupt = () => { pending = false; remember(); };
    // A phonetic index can populate the filtered list after it first renders.
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    restore();
    events.addEventListener('scroll', remember, { passive: true });
    events.addEventListener('wheel', interrupt, { passive: true });
    events.addEventListener('touchstart', interrupt, { passive: true });
    events.addEventListener('pointerdown', interrupt, { passive: true });
    events.addEventListener('keydown', interrupt);
    return () => {
      observer.disconnect();
      events.removeEventListener('scroll', remember);
      events.removeEventListener('wheel', interrupt);
      events.removeEventListener('touchstart', interrupt);
      events.removeEventListener('pointerdown', interrupt);
      events.removeEventListener('keydown', interrupt);
    };
  }, [page, state, detailKey]);

  return rememberListPosition;
}
