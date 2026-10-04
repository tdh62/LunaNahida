export const primaryPages = ['/', '/music', '/liked', '/recent', '/tags', '/artists', '/albums', '/playlists', '/settings'];
export const DETAIL_PAGE_LIMIT = 6;

// Primary pages are bounded by the navigation menu. Keep only recent detail DOMs.
export function retainPage(pages: readonly string[], route: string) {
  const next = [...pages.filter(page => page !== route), route];
  const details = next.filter(page => !primaryPages.includes(page));
  const removed = new Set(details.slice(0, Math.max(0, details.length - DETAIL_PAGE_LIMIT)));
  return next.filter(page => !removed.has(page));
}
