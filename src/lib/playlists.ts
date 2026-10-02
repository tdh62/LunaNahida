import type { TrackConditions, TrackSort } from './track-query';
import type { Track } from './music';

export type PlaylistRules = {conditions: TrackConditions; sort: TrackSort; descending: boolean};
export type Playlist = { rules?: PlaylistRules; id: string; name: string; description: string; trackIds: number[]; cover: string; coverMode: 'first-track' | 'upload' };

export function playlistCover(playlist: Playlist, tracks: Track[]): string {
  if (playlist.coverMode === 'upload') return playlist.cover || '/covers/local.svg';
  return tracks.find(track => track.id === playlist.trackIds[0])?.cover || '/covers/local.svg';
}
