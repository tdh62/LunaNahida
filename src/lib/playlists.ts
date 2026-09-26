import type { Track } from './music';

export type Playlist = { id: string; name: string; description: string; trackIds: number[]; cover: string; coverMode: 'first-track' | 'upload' };

export function playlistCover(playlist: Playlist, tracks: Track[]): string {
  if (playlist.coverMode === 'upload') return playlist.cover || '/covers/local.svg';
  return tracks.find(track => track.id === playlist.trackIds[0])?.cover || '/covers/local.svg';
}
