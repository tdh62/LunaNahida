import type { Track } from './music';
import type { Playlist } from './playlists';
import type { ArtistMapping } from './catalog';

export type StoredSettings = {
  dropAction: 'ask' | 'temporary' | 'library' | 'watch';
  scanOnStart: boolean;
  scanIntervalMinutes: number;
  theme: string;
  appearance: 'dark' | 'light';
  visual: string;
  lyricEffect: string;
  lyricScroll: string;
  showTranslation: boolean;
  lyricAppearance: { font: string; size: number; lineHeight: number; spacing: number };
  artistMappings: ArtistMapping[];
  volume: number;
  mode: 'list' | 'repeat' | 'shuffle' | 'stop-track' | 'stop-list';
  effect: string;
  equalizer: number[];
};

export type LibraryState = { tracks: Track[]; playlists: Playlist[]; liked: number[]; recent: number[]; queue: number[]; folders: string[]; settings: StoredSettings };
export type ScanResult = { added: number; updated: number; missing: number; folders: number; errors: string[] };

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
  settings: (value: StoredSettings) => request<StoredSettings>('/api/settings', 'PUT', value),
  playlists: (value: Playlist[]) => request<{ ok: boolean }>('/api/playlists', 'PUT', value),
  liked: (value: number[]) => request<{ ok: boolean }>('/api/liked', 'PUT', value),
  queue: (value: number[]) => request<{ ok: boolean }>('/api/queue', 'PUT', value),
  history: (id: number) => request<{ ok: boolean }>('/api/history', 'POST', { id }),
  duration: (id: number, duration: number) => request<{ ok: boolean }>(`/api/tracks/${id}/duration`, 'PUT', { duration }),
  enrichment: (id: number, cover: string, lyric: string, translation: string, fallbackOnly = false) => request<{ ok: boolean }>(`/api/tracks/${id}/enrichment${fallbackOnly ? '?fallback=1' : ''}`, 'PUT', { cover, lyric, translation }),
  import: (paths: string[], mode: 'temporary' | 'library' | 'watch') => request<Track[]>('/api/import', 'POST', { paths, mode }),
  scan: () => request<ScanResult>('/api/scan', 'POST'),
  addFolder: (path: string) => request<{ ok: boolean }>('/api/folders', 'POST', { path }),
  removeFolder: (path: string) => request<{ ok: boolean }>('/api/folders', 'DELETE', { path }),
  chooseFiles: () => request<{ paths: string[] }>('/api/dialog/files'),
  chooseFolder: () => request<{ paths: string[] }>('/api/dialog/folder'),
  uploadCover: async (file: File) => {
    const form = new FormData(); form.append('image', file);
    const response = await fetch('/api/media/cover', { method: 'POST', body: form });
    if (!response.ok) throw new Error('封面保存失败');
    return (await response.json() as { cover: string }).cover;
  },
};
