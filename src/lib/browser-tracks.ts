import type { Track } from './music.ts';
import { detectSampleRate } from './audio-sample-rate.ts';

const audioExtensions = /\.(mp3|wav|flac|ogg|opus|m4a|aac|aiff|aif|wma|webm|mp4)$/i;
const encryptedExtensions = /\.(ncm|qmc\w*|mgg\w*|mflac\w*|kgm\w*|vpr|kwm|xm|x2m|x3m|tm\w*)$/i;

export const isBrowserTrack = (track: Track) => track.temporary === true && track.source.startsWith('blob:');

export class BrowserTrackPool {
  private nextId = -1000000000;
  private entries = new Map<string, { track: Track; key: string }>();

  constructor(private urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL) {}

  async add(files: File[]) {
    const tracks: Track[] = [];
    const rejected: string[] = [];
    for (const file of files.slice(0, 1000)) {
      if (!file.size || encryptedExtensions.test(file.name) || !audioExtensions.test(file.name) && !file.type.startsWith('audio/')) {
        rejected.push(file.name);
        continue;
      }
      const key = JSON.stringify([file.name, file.size, file.lastModified, file.type]);
      const existing = [...this.entries.values()].find(entry => entry.key === key);
      if (existing) { tracks.push(existing.track); continue; }
      let sampleRate: number | null = null;
      try { sampleRate = detectSampleRate(new Uint8Array(await file.slice(0, 262144).arrayBuffer())); }
      catch { rejected.push(file.name); continue; }
      const source = this.urls.createObjectURL(file);
      const track: Track = {
        id: this.nextId--, title: file.name.replace(/\.[^.]+$/, ''), english: '', artist: '本地文件', album: '本次播放',
        duration: 0, cover: '/covers/local.svg', genre: '', year: '', color: '#8daab0', source,
        fileName: file.name, temporary: true, available: true, quality: sampleRate ? { sampleRate } : undefined,
      };
      this.entries.set(source, { track, key });
      tracks.push(track);
    }
    rejected.push(...files.slice(1000).map(file => file.name));
    return { tracks, rejected };
  }

  retain(sources: Set<string>) {
    for (const source of this.entries.keys()) {
      if (sources.has(source)) continue;
      this.urls.revokeObjectURL(source);
      this.entries.delete(source);
    }
  }

  dispose() { this.retain(new Set()); }
}
