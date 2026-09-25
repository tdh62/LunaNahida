import { Converter } from 'opencc-js';
import type { Track } from '@/lib/music';

export type ArtistMapping = { root: string; aliases: string[] };
export type ArtistEntry = { key: string; name: string; tracks: Track[]; cover: string; aliases: string[] };
export type AlbumEntry = { key: string; name: string; artistKey: string; artistName: string; tracks: Track[]; cover: string; year: string };

const toSimplified = Converter({ from: 'tw', to: 'cn' });
export const normalizeName = (name: string) => toSimplified(name.trim()).toLocaleLowerCase();

export function artistKey(name: string, mappings: ArtistMapping[]) {
  const normalized = normalizeName(name);
  const group = mappings.find(item => [item.root, ...item.aliases].some(alias => normalizeName(alias) === normalized));
  return normalizeName(group?.root ?? name);
}

export function buildCatalog(tracks: Track[], mappings: ArtistMapping[]) {
  const artists = new Map<string, ArtistEntry>();
  const albums = new Map<string, AlbumEntry>();
  for (const track of tracks) {
    const key = artistKey(track.artist, mappings);
    const mapping = mappings.find(item => normalizeName(item.root) === key);
    let artist = artists.get(key);
    if (!artist) {
      artist = { key, name: mapping?.root ?? track.artist, tracks: [], cover: track.cover, aliases: [] };
      artists.set(key, artist);
    }
    artist.tracks.push(track);
    if (!artist.aliases.includes(track.artist)) artist.aliases.push(track.artist);
    const albumKey = normalizeName(track.album);
    const id = `${key}::${albumKey}`;
    let album = albums.get(id);
    if (!album) {
      album = { key: albumKey, name: track.album, artistKey: key, artistName: artist.name, tracks: [], cover: track.cover, year: track.year };
      albums.set(id, album);
    } else if (!/^\d{4}$/.test(album.year.trim()) && /^\d{4}$/.test(track.year.trim())) {
      album.year = track.year;
    }
    album.tracks.push(track);
  }
  return { artists: [...artists.values()], albums: [...albums.values()] };
}
