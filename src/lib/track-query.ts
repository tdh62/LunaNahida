import { trackTags, type Track } from './music.ts';

export type TrackConditions = {
  keyword?: string; artist?: string; album?: string; tags?: string[]; tagMode?: 'all' | 'any';
  source?: 'all' | 'local' | 'network'; availability?: 'all' | 'playable' | 'missing';
  favorite?: 'all' | 'liked' | 'unliked'; format?: string;
  minDuration?: number; maxDuration?: number; minYear?: number; maxYear?: number;
};
export type TrackSort = 'original' | 'title' | 'artist' | 'album' | 'duration' | 'year' | 'added';
export const playableTrack = (track: Track) => track.available !== false && track.playbackStatus !== 'unplayable';
export function trackFormat(track: Track) {
  return (track.fileName || track.path || track.source).split(/[?#]/)[0].split('.').at(-1)?.toLowerCase() ?? '';
}
export function matchesTrack(track: Track, conditions: TrackConditions, liked: ReadonlySet<number>) {
  const contains = (value: string, term?: string) => !term?.trim() || value.normalize('NFKC').toLocaleLowerCase().includes(term.trim().normalize('NFKC').toLocaleLowerCase());
  if (!contains([track.title, track.artist, track.album, ...trackTags(track)].join(' '), conditions.keyword) || !contains(track.artist, conditions.artist) || !contains(track.album, conditions.album)) return false;
  const tags = new Set(trackTags(track).map(tag => tag.toLocaleLowerCase()));
  const conditionTags = (conditions.tags ?? []).map(tag => tag.trim().toLocaleLowerCase()).filter(Boolean);
  if (conditionTags.length && !(conditions.tagMode === 'any' ? conditionTags.some(tag => tags.has(tag)) : conditionTags.every(tag => tags.has(tag)))) return false;
  if (conditions.source && conditions.source !== 'all' && (track.kind ?? 'local') !== conditions.source) return false;
  if (conditions.availability && conditions.availability !== 'all' && playableTrack(track) !== (conditions.availability === 'playable')) return false;
  if (conditions.favorite && conditions.favorite !== 'all' && liked.has(track.id) !== (conditions.favorite === 'liked')) return false;
  if (conditions.format && trackFormat(track) !== conditions.format.toLowerCase()) return false;
  if (conditions.minDuration !== undefined && track.duration < conditions.minDuration || conditions.maxDuration !== undefined && track.duration > conditions.maxDuration) return false;
  const year = Number.parseInt(track.year, 10);
  if ((conditions.minYear !== undefined || conditions.maxYear !== undefined) && !Number.isFinite(year)) return false;
  return !(conditions.minYear !== undefined && year < conditions.minYear || conditions.maxYear !== undefined && year > conditions.maxYear);
}
export function queryTracks(tracks: Track[], conditions: TrackConditions, liked: number[], sort: TrackSort = 'original', descending = false) {
  const likedSet = new Set(liked);
  const result = tracks.filter(track => matchesTrack(track, conditions, likedSet));
  if (sort === 'original') return result;
  return result.sort((a, b) => {
    let comparison = 0;
    if (sort === 'duration') comparison = a.duration - b.duration;
    else if (sort === 'year') comparison = (Number.parseInt(a.year, 10) || 0) - (Number.parseInt(b.year, 10) || 0);
    else if (sort === 'added') comparison = (a.addedAt ?? a.id) - (b.addedAt ?? b.id);
    else comparison = a[sort].localeCompare(b[sort], 'zh-CN', { numeric: true });
    return descending ? -comparison : comparison;
  });
}
