import { trackTags, type Track } from './music.ts';
import type { matchesSearch } from './phonetic-search.ts';

export type TrackConditions = {
  keyword?: string; artist?: string; album?: string; tags?: string[]; tagMode?: 'all' | 'any';
  source?: 'all' | 'local' | 'network'; availability?: 'all' | 'playable' | 'missing';
  favorite?: 'all' | 'liked' | 'unliked'; format?: string;
  minDuration?: number; maxDuration?: number; minYear?: number; maxYear?: number;
};
export type TrackSort = 'original' | 'title' | 'artist' | 'album' | 'duration' | 'year' | 'added';
export function validateTrackConditions(conditions: TrackConditions) {
  for (const text of [conditions.keyword, conditions.artist, conditions.album]) if (text && [...text].length > 200) throw new Error('条件文字最多 200 个字符');
  if ((conditions.tags?.length ?? 0) > 50 || conditions.tags?.some(tag => [...tag].length > 60)) throw new Error('最多 50 个标签，每个标签最多 60 个字符');
  for (const [minimum, maximum, label] of [[conditions.minDuration, conditions.maxDuration, '时长'], [conditions.minYear, conditions.maxYear, '年份']] as const) {
    for (const value of [minimum, maximum]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`${label}条件无效`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) throw new Error(`${label}下限不能大于上限`);
  }
  for (const year of [conditions.minYear, conditions.maxYear]) if (year !== undefined && (!Number.isInteger(year) || year > 9999)) throw new Error('年份须为 0–9999 的整数');
}
export const playableTrack = (track: Track) => track.available !== false && track.playbackStatus !== 'unplayable';
export function trackFormat(track: Track) {
  return (track.fileName || track.path || track.source).split(/[?#]/)[0].split('.').at(-1)?.toLowerCase() ?? '';
}
const literalSearch: typeof matchesSearch = (values, term) => !term?.trim() || (typeof values === 'string' ? values : values.join(' ')).normalize('NFKC').toLocaleLowerCase().includes(term.trim().normalize('NFKC').toLocaleLowerCase());
export function matchesTrack(track: Track, conditions: TrackConditions, liked: ReadonlySet<number>, searchMatch = literalSearch) {
  if (!searchMatch([track.title, track.artist, track.album, ...trackTags(track)], conditions.keyword) || !searchMatch(track.artist, conditions.artist) || !searchMatch(track.album, conditions.album)) return false;
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
export function queryTracks(tracks: Track[], conditions: TrackConditions, liked: number[], sort: TrackSort = 'original', descending = false, searchMatch = literalSearch) {
  const likedSet = new Set(liked);
  const result = tracks.filter(track => matchesTrack(track, conditions, likedSet, searchMatch));
  if (sort === 'original') return result;
  return result.sort((a, b) => {
    let comparison: number;
    if (sort === 'duration') comparison = a.duration - b.duration;
    else if (sort === 'year') comparison = (Number.parseInt(a.year, 10) || 0) - (Number.parseInt(b.year, 10) || 0);
    else if (sort === 'added') comparison = (a.addedAt ?? a.id) - (b.addedAt ?? b.id);
    else comparison = a[sort].localeCompare(b[sort], 'zh-CN', { numeric: true });
    return descending ? -comparison : comparison;
  });
}
