import { ArrowDownAZ, ArrowLeft, Disc3, ListMusic, Mic2, Play, RefreshCw, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LibraryView from '@/components/LibraryView';
import type { AlbumEntry, ArtistEntry } from '@/lib/catalog';
import type { Track } from '@/lib/music';
import type { Playlist } from '@/lib/playlists';

type ArtistDescription = { id: string; name: string; picture?: string; briefDesc: string; introduction: { ti: string; txt: string }[] };
const artistDescriptionStorageKey = 'lumatune-artist-descriptions-v1';

function readArtistDescriptionCache(name: string) {
  try {
    const cache = JSON.parse(localStorage.getItem(artistDescriptionStorageKey) ?? '{}');
    return cache[name.trim().normalize('NFKC').toLowerCase()] as ArtistDescription | undefined;
  } catch { return undefined; }
}

function saveArtistDescriptionCache(name: string, data: ArtistDescription) {
  try {
    const cache = JSON.parse(localStorage.getItem(artistDescriptionStorageKey) ?? '{}');
    const key = name.trim().normalize('NFKC').toLowerCase();
    const entries = Object.entries(cache).filter(([existing]) => existing !== key).slice(-19);
    localStorage.setItem(artistDescriptionStorageKey, JSON.stringify(Object.fromEntries([...entries, [key, data]])));
  } catch { /* Keep artist details available for the current session if storage is full. */ }
}

async function fetchArtistDescription(name: string, refresh = false, signal?: AbortSignal) {
  const params = new URLSearchParams({ name });
  if (refresh) params.set('refresh', '1');
  const response = await fetch(`/api/music/artist?${params}`, { signal });
  if (response.status === 404) throw new Error('暂未收录歌手介绍');
  if (!response.ok) throw new Error('歌手介绍暂时不可用');
  return response.json() as Promise<ArtistDescription>;
}

type Props = {
  kind: 'artists' | 'albums';
  artists: ArtistEntry[];
  albums: AlbumEntry[];
  artist?: ArtistEntry;
  album?: AlbumEntry;
  currentId: number | null;
  liked: number[];
  playlists: Playlist[];
  onPlay: (id: number) => void;
  onToggleLike: (id: number) => void;
  onViewInfo: (track: Track) => void;
  onRefreshInfo: (track: Track) => void;
  onAddToPlaylist: (id: string, ids: number[]) => void;
  onArtist: (name: string) => void;
  onAlbum: (track: Track) => void;
};

const yearValue = (year: string) => /^\d{4}$/.test(year.trim()) ? Number(year) : null;
const compareText = (a: string, b: string) => a.localeCompare(b, 'zh-CN');

export default function CatalogView({ kind, artists, albums, artist, album, currentId, liked, playlists, onPlay, onToggleLike, onViewInfo, onRefreshInfo, onAddToPlaylist, onArtist, onAlbum }: Props) {
  const navigate = useNavigate();
  const detail = kind === 'artists' ? artist : album;
  const items = kind === 'artists' ? artists : albums;
  const label = kind === 'artists' ? '歌手' : '专辑';
  const relatedAlbums = artist ? albums.filter(item => item.artistKey === artist.key) : [];
  const [artistTab, setArtistTab] = useState<'albums' | 'songs'>('albums');
  const [search, setSearch] = useState('');
  const [artistSort, setArtistSort] = useState<'added' | 'name' | 'tracks'>('added');
  const [albumSort, setAlbumSort] = useState<'added' | 'year' | 'name' | 'artist'>('added');
  const [artistDescription, setArtistDescription] = useState<{ name: string; data: ArtistDescription } | null>(null);
  const [artistDescriptionError, setArtistDescriptionError] = useState('');
  const [artistDescriptionLoading, setArtistDescriptionLoading] = useState(false);
  useEffect(() => {
    if (!artist || kind !== 'artists') return;
    const controller = new AbortController();
    setArtistDescriptionError('');
    const cachedDescription = readArtistDescriptionCache(artist.name);
    if (cachedDescription) {
      setArtistDescription({ name: artist.name, data: cachedDescription });
      setArtistDescriptionLoading(false);
      return () => controller.abort();
    }
    setArtistDescriptionLoading(true);
    fetchArtistDescription(artist.name, false, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          saveArtistDescriptionCache(artist.name, data);
          setArtistDescription({ name: artist.name, data });
        }
      })
      .catch(error => { if (!controller.signal.aborted) setArtistDescriptionError(error instanceof Error ? error.message : '歌手介绍暂时不可用'); })
      .finally(() => { if (!controller.signal.aborted) setArtistDescriptionLoading(false); });
    return () => controller.abort();
  }, [artist?.key, artist?.name, kind]);
  const filteredArtists = useMemo(() => {
    const result = artists.filter(item => `${item.name} ${item.aliases.join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    if (artistSort === 'name') result.sort((a, b) => compareText(a.name, b.name));
    if (artistSort === 'tracks') result.sort((a, b) => b.tracks.length - a.tracks.length || compareText(a.name, b.name));
    return result;
  }, [artists, artistSort, search]);
  const filteredAlbums = useMemo(() => {
    const result = albums.filter(item => `${item.name} ${item.artistName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
    if (albumSort === 'year') result.sort((a, b) => {
      const yearA = yearValue(a.year), yearB = yearValue(b.year);
      if (yearA === null || yearB === null) return yearA === yearB ? compareText(a.name, b.name) : yearA === null ? 1 : -1;
      return yearB - yearA || compareText(a.name, b.name);
    });
    if (albumSort === 'name') result.sort((a, b) => compareText(a.name, b.name));
    if (albumSort === 'artist') result.sort((a, b) => compareText(a.artistName, b.artistName) || compareText(a.name, b.name));
    return result;
  }, [albums, albumSort, search]);
  const refreshArtistDescription = async () => {
    if (!artist) return;
    setArtistDescriptionLoading(true);
    setArtistDescriptionError('');
    try {
      const data = await fetchArtistDescription(artist.name, true);
      saveArtistDescriptionCache(artist.name, data);
      setArtistDescription({ name: artist.name, data });
    } catch (error) {
      setArtistDescriptionError(error instanceof Error ? error.message : '歌手介绍暂时不可用');
    } finally {
      setArtistDescriptionLoading(false);
    }
  };
  const artistCover = artist
    ? (artistDescription?.name === artist.name ? artistDescription.data.picture : undefined) ?? artist.tracks.find(track => track.cover !== '/covers/local.svg')?.cover ?? artist.cover
    : detail?.cover ?? '/covers/local.svg';
  return <section className="catalog-page">
    {detail ? <>
      <Link className="playlist-back" to={kind === 'artists' ? '/artists' : '/albums'}><ArrowLeft size={16} /> 返回{label}</Link>
      <header className="catalog-hero"><img src={kind === 'artists' ? artistCover : detail.cover} alt="" /><div><span className="eyebrow"><span /> {kind === 'artists' ? 'ARTIST' : 'ALBUM'}</span><h1>{detail.name}</h1>
        {album && kind === 'albums' && <button className="catalog-text-link" onClick={() => onArtist(album.artistName)}>{album.artistName}</button>}
        {artist && kind === 'artists' && artist.aliases.length > 1 && <p>收录名称：{artist.aliases.join(' / ')}</p>}
        <p>{detail.tracks.length} 首歌曲{album && kind === 'albums' ? ` · ${yearValue(album.year) === null ? '未知年份' : album.year}` : ''}</p>
        <button type="button" className="playlist-primary" onClick={() => onPlay(detail.tracks[0].id)}><Play size={16} fill="currentColor" /> 播放</button>
      </div></header>
      {artist && kind === 'artists' && <section className="artist-description" aria-label="歌手介绍">
        <div className="artist-description-heading"><h2>歌手介绍</h2><button type="button" className="artist-description-refresh" onClick={() => void refreshArtistDescription()} disabled={artistDescriptionLoading}><RefreshCw size={14} className={artistDescriptionLoading ? 'animate-spin' : ''} />刷新资料</button></div>
        {artistDescriptionLoading && <p className="artist-description-status">正在加载歌手介绍…</p>}
        {artistDescriptionError && !artistDescriptionLoading && <p className="artist-description-status">{artistDescriptionError}</p>}
        {artistDescription?.name === artist.name && <>
          {artistDescription.data.briefDesc && <p className="artist-description-brief">{artistDescription.data.briefDesc}</p>}
          {artistDescription.data.introduction.map((section, index) => <section className="artist-description-section" key={`${section.ti}-${index}`}><h2>{section.ti}</h2><p>{section.txt}</p></section>)}
        </>}
      </section>}
      {artist && kind === 'artists' ? <>
        <div className="catalog-tabs" role="tablist" aria-label="歌手内容">
          <button type="button" role="tab" aria-selected={artistTab === 'albums'} className={artistTab === 'albums' ? 'active' : ''} onClick={() => setArtistTab('albums')}><Disc3 size={15} />专辑<span>{relatedAlbums.length}</span></button>
          <button type="button" role="tab" aria-selected={artistTab === 'songs'} className={artistTab === 'songs' ? 'active' : ''} onClick={() => setArtistTab('songs')}><ListMusic size={15} />歌曲<span>{artist.tracks.length}</span></button>
        </div>
        {artistTab === 'albums' ? <div className="catalog-related"><div className="catalog-grid">{relatedAlbums.map(item => <button type="button" className="catalog-card" key={item.key} onClick={() => navigate(`/albums/${encodeURIComponent(item.artistKey)}/${encodeURIComponent(item.key)}`)}><span className="catalog-cover"><img src={item.cover} alt="" /><small className="catalog-cover-badge">{item.tracks.length} 首</small></span><strong>{item.name}</strong>{yearValue(item.year) !== null && <small>{item.year}</small>}</button>)}</div>{!relatedAlbums.length && <div className="library-empty"><Disc3 size={28} /><p>暂无专辑</p></div>}</div> : <div className="catalog-songs"><LibraryView key={`artist-${artist.key}`} title="歌曲" tracks={artist.tracks} currentId={currentId} liked={liked} playlists={playlists} onPlay={onPlay} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onRefreshInfo={onRefreshInfo} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum} /></div>}
      </> : <div className="catalog-songs"><h2>歌曲</h2><LibraryView key={`${kind}-${detail.name}`} title="歌曲" tracks={detail.tracks} currentId={currentId} liked={liked} playlists={playlists} onPlay={onPlay} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onRefreshInfo={onRefreshInfo} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum} /></div>}
    </> : <><header className="catalog-heading"><span className="eyebrow"><span /> YOUR COLLECTION</span><h1>{label}</h1><p>音乐库中共 {items.length} {kind === 'artists' ? '位歌手' : '张专辑'}</p></header>
      <div className="catalog-toolbar"><label className="catalog-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} aria-label={`搜索${label}`} placeholder={kind === 'artists' ? '搜索歌手名称' : '搜索专辑或歌手'} /></label><label className="catalog-sort"><ArrowDownAZ size={16} /><span>排序</span><select aria-label={`${label}排序`} value={kind === 'artists' ? artistSort : albumSort} onChange={event => kind === 'artists' ? setArtistSort(event.target.value as typeof artistSort) : setAlbumSort(event.target.value as typeof albumSort)}>{kind === 'artists' ? <><option value="added">添加时间</option><option value="name">名称</option><option value="tracks">歌曲数量</option></> : <><option value="added">添加时间</option><option value="year">发行年份</option><option value="name">专辑名称</option><option value="artist">歌手名称</option></>}</select></label></div>
      <div className="catalog-grid">{kind === 'artists' ? filteredArtists.map(item => <button type="button" className="catalog-card" key={item.key} onClick={() => navigate(`/artists/${encodeURIComponent(item.key)}`)}><span className="catalog-cover"><img src={item.cover} alt="" /><small className="catalog-cover-badge">{item.tracks.length} 首</small></span><strong>{item.name}</strong><small><Mic2 size={13} /> {albums.filter(albumItem => albumItem.artistKey === item.key).length} 张专辑</small></button>) : filteredAlbums.map(item => <button type="button" className="catalog-card" key={`${item.artistKey}-${item.key}`} onClick={() => navigate(`/albums/${encodeURIComponent(item.artistKey)}/${encodeURIComponent(item.key)}`)}><span className="catalog-cover"><img src={item.cover} alt="" /><small className="catalog-cover-badge">{item.tracks.length} 首</small></span><strong>{item.name}</strong><small><Users size={13} /> {item.artistName}{yearValue(item.year) === null ? '' : ` · ${item.year}`}</small></button>)}</div>
      {!items.length && <div className="library-empty"><Disc3 size={28} /><p>音乐库还没有歌曲</p></div>}
      {items.length > 0 && (kind === 'artists' ? filteredArtists.length : filteredAlbums.length) === 0 && <div className="library-empty"><Search size={25} /><p>没有找到匹配的{label}</p></div>}
    </>}
  </section>;
}
