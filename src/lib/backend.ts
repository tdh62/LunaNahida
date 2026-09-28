import type { Track } from './music';
import type { Playlist } from './playlists';
import type { ArtistMapping } from './catalog';
import type { SavedEffect } from './audio-filter';

export type ScopeSettings = { mode: 'spectrum' | 'waveform'; fftSize: 2048 | 4096 | 8192 | 16384; minFrequency: number; maxFrequency: number; smoothing: number };
export const defaultScopeSettings: ScopeSettings = { mode: 'spectrum', fftSize: 8192, minFrequency: 20, maxFrequency: 20000, smoothing: 0.72 };

export type StoredSettings = {
  dropAction: 'ask' | 'temporary' | 'library' | 'watch';
  scanOnStart: boolean;
  scanIntervalMinutes: number;
  autoConvert: boolean;
  backupOriginal: boolean;
  theme: string;
  appearance: 'dark' | 'light';
  visual: string;
  scope: ScopeSettings;
  lyricEffect: string;
  lyricScroll: string;
  showTranslation: boolean;
  lyricAppearance: { font: string; size: number; lineHeight: number; spacing: number };
  artistMappings: ArtistMapping[];
  volume: number;
  mode: 'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list';
  effect: string;
  customEffects: SavedEffect[];
  equalizer: number[];
};

export type LibraryState = { tracks: Track[]; tags: string[]; playlists: Playlist[]; liked: number[]; recent: number[]; queue: number[]; folders: string[]; settings: StoredSettings };
export type ScanResult = { added: number; updated: number; missing: number; folders: number; errors: string[] };
export type ConversionResult = { source: string; output?: string; backup?: string; status: 'converted' | 'failed'; error?: string; track?: Track };
export type CacheStats = { coverBytes: number; webviewBytes: number; metadataBytes: number; totalBytes: number; webviewClearPending: boolean };

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const backend = {
  state: () => request<LibraryState>('/api/state'),
  deleteTracks: (ids: number[]) => request<{ ok: boolean }>('/api/tracks', 'DELETE', { ids }),
  createTag: (name: string) => request<{ ok: boolean }>('/api/tags', 'POST', { name }),
  renameTag: (oldName: string, newName: string) => request<{ ok: boolean }>('/api/tags/rename', 'PUT', { oldName, newName }),
  deleteTag: (name: string) => request<{ ok: boolean }>('/api/tags', 'DELETE', { name }),
  changeTrackTag: (ids: number[], name: string, add: boolean) => request<{ ok: boolean }>('/api/tracks/tags', 'PATCH', { ids, name, add }),
  settings: (value: StoredSettings) => request<StoredSettings>('/api/settings', 'PUT', value),
  playlists: (value: Playlist[]) => request<{ ok: boolean }>('/api/playlists', 'PUT', value),
  liked: (value: number[]) => request<{ ok: boolean }>('/api/liked', 'PUT', value),
  queue: (value: number[]) => request<{ ok: boolean }>('/api/queue', 'PUT', value),
  history: (id: number) => request<{ ok: boolean }>('/api/history', 'POST', { id }),
  duration: (id: number, duration: number) => request<{ ok: boolean }>(`/api/tracks/${id}/duration`, 'PUT', { duration }),
  updateTrackMetadata: (id: number, title: string, artist: string, album: string) => request<Track>(`/api/tracks/${id}/metadata`, 'PUT', { title, artist, album }),
  enrichment: (id: number, cover: string, lyric: string, translation: string, fallbackOnly = false) => request<{ ok: boolean }>(`/api/tracks/${id}/enrichment${fallbackOnly ? '?fallback=1' : ''}`, 'PUT', { cover, lyric, translation }),
  saveLyrics: (track: Track) => request<Track>(`/api/tracks/${track.id}/lyrics`, 'POST', { lyrics: track.lyrics }),
  import: (paths: string[], mode: 'temporary' | 'library' | 'watch') => request<Track[]>('/api/import', 'POST', { paths, mode }),
  inspectConversion: (paths: string[]) => request<{ paths: string[] }>('/api/conversion/inspect', 'POST', { paths }),
  convert: (path: string, addToLibrary: boolean) => request<ConversionResult>('/api/conversion', 'POST', { path, addToLibrary }),
  playbackStatus: (id: number, status: 'unknown' | 'playable' | 'unplayable') => request<{ ok: boolean }>(`/api/tracks/${id}/playback`, 'PUT', { status }),
  scan: () => request<ScanResult>('/api/scan', 'POST'),
  cacheStats: () => request<CacheStats>('/api/cache'),
  clearCache: () => request<CacheStats>('/api/cache/clear', 'POST'),
  addFolder: (path: string) => request<{ ok: boolean }>('/api/folders', 'POST', { path }),
  removeFolder: (path: string) => request<{ ok: boolean }>('/api/folders', 'DELETE', { path }),
  chooseFiles: () => request<{ paths: string[] }>('/api/dialog/files'),
  chooseFolder: () => request<{ paths: string[] }>('/api/dialog/folder'),
  chooseCover: () => request<{ cover: string }>('/api/dialog/cover'),
  uploadCover: async (file: File) => {
    const form = new FormData(); form.append('image', file);
    const response = await fetch('/api/media/cover', { method: 'POST', body: form });
    if (!response.ok) throw new Error('封面保存失败');
    return (await response.json() as { cover: string }).cover;
  },
};
