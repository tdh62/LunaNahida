import { ArrowDownAZ, ArrowLeft, Disc3, Info, ListMusic, Mic2, Play, RefreshCw, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import LibraryView from '@/components/LibraryView';
import { backend } from '@/lib/backend';
import type { AlbumEntry, ArtistEntry } from '@/lib/catalog';
import { formatTime, type Track } from '@/lib/music';
import type { Playlist } from '@/lib/playlists';

type ArtistDescription = { id: string; name: string; picture?: string; briefDesc: string; introduction: { ti: string; txt: string }[] };
type AlbumDescription = {
  id: string; name: string; picture?: string; description: string; artist: string;
  type: string; subType: string; company: string; publishTime?: number; size: number;
  aliases: string[]; tags: string[]; commentCount?: number; shareCount?: number;
  songs: { id: string; name: string; artist: string; duration: number; number: number; disc: string }[];
};
const artistDescriptions = new Map<string, ArtistDescription>();
const albumDescriptions = new Map<string, AlbumDescription>();
if (typeof window !== 'undefined') window.addEventListener('lunanahida-cache-cleared', () => { artistDescriptions.clear(); albumDescriptions.clear(); });

function readArtistDescriptionCache(name: string) {
  return artistDescriptions.get(name.trim().normalize('NFKC').toLowerCase());
}

function saveArtistDescriptionCache(name: string, data: ArtistDescription) {
  artistDescriptions.set(name.trim().normalize('NFKC').toLowerCase(), data);
}

async function fetchArtistDescription(name: string, refresh = false, signal?: AbortSignal) {
  const params = new URLSearchParams({ name });
  if (refresh) params.set('refresh', '1');
  const response = await fetch(`/api/music/artist?${params}`, { signal });
  if (response.status === 404) throw new Error('暂未收录歌手介绍');
  if (!response.ok) throw new Error('歌手介绍暂时不可用');
  return response.json() as Promise<ArtistDescription>;
}

function albumCacheKey(album: AlbumEntry) {
  return `${album.artistKey}\u0000${album.key}`;
}

function readAlbumDescriptionCache(key: string): AlbumDescription | undefined {
  return albumDescriptions.get(key);
}

function saveAlbumDescriptionCache(key: string, data: AlbumDescription) {
  albumDescriptions.set(key, data);
}

async function fetchAlbumDescription(album: AlbumEntry, refresh = false, signal?: AbortSignal) {
  const params = new URLSearchParams({ name: album.name, artist: album.artistName });
  if (refresh) params.set('refresh', '1');
  const response = await fetch(`/api/music/album?${params}`, { signal });
  if (response.status === 404) throw new Error('暂未找到匹配的专辑资料');
  if (!response.ok) throw new Error('专辑资料暂时不可用');
  return response.json() as Promise<AlbumDescription>;
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
  onPlayTracks: (tracks: Track[], startId?: number) => void;
  onToggleLike: (id: number) => void;
  onViewInfo: (track: Track) => void;
  onRefreshInfo: (track: Track) => void;
  onSaveLyrics: (track: Track) => void;
  onAddToPlaylist: (id: string, ids: number[]) => void;
  onArtist: (name: string) => void;
  onAlbum: (track: Track) => void;
};

const yearValue = (year: string) => /^\d{4}$/.test(year.trim()) ? Number(year) : null;
const compareText = (a: string, b: string) => a.localeCompare(b, 'zh-CN');

export default function CatalogView({ kind, artists, albums, artist, album, currentId, liked, playlists, onPlayTracks, onToggleLike, onViewInfo, onRefreshInfo, onSaveLyrics, onAddToPlaylist, onArtist, onAlbum }: Props) {
  const navigate = useNavigate();
  const detail = kind === 'artists' ? artist : album;
  const items = kind === 'artists' ? artists : albums;
  const label = kind === 'artists' ? '歌手' : '专辑';
  const relatedAlbums = artist ? albums.filter(item => item.artistKey === artist.key) : [];
  const [artistTab, setArtistTab] = useState<'albums' | 'songs' | 'info'>('albums');
  const [albumTab, setAlbumTab] = useState<'songs' | 'info'>('songs');
  const [search, setSearch] = useState('');
  const [artistSort, setArtistSort] = useState<'added' | 'name' | 'tracks'>('added');
  const [albumSort, setAlbumSort] = useState<'added' | 'year' | 'name' | 'artist'>('added');
  const [artistDescription, setArtistDescription] = useState<{ name: string; data: ArtistDescription } | null>(null);
  const [artistDescriptionError, setArtistDescriptionError] = useState('');
  const [artistDescriptionLoading, setArtistDescriptionLoading] = useState(false);
  const [albumDescription, setAlbumDescription] = useState<{ key: string; data: AlbumDescription } | null>(null);
  const [albumDescriptionError, setAlbumDescriptionError] = useState('');
  const [albumDescriptionLoading, setAlbumDescriptionLoading] = useState(false);
  const albumRequest = useRef<AbortController | null>(null);
  const selectedAlbumKey = album && kind === 'albums' ? albumCacheKey(album) : '';
  const selectedAlbumKeyRef = useRef(selectedAlbumKey);
  selectedAlbumKeyRef.current = selectedAlbumKey;
  useEffect(() => { setArtistTab('albums'); }, [artist?.key]);
  useEffect(() => {
    if (!album || kind !== 'albums') return;
    const key = albumCacheKey(album);
    const cached = readAlbumDescriptionCache(key);
    setAlbumDescriptionError('');
    if (cached) {
      setAlbumDescription({ key, data: cached });
      setAlbumDescriptionLoading(false);
      return () => albumRequest.current?.abort();
    }
    const controller = new AbortController();
    albumRequest.current = controller;
    setAlbumDescriptionLoading(true);
    fetchAlbumDescription(album, false, controller.signal)
      .then(data => { if (!controller.signal.aborted) { saveAlbumDescriptionCache(key, data); setAlbumDescription({ key, data }); } })
      .catch(error => { if (!controller.signal.aborted) setAlbumDescriptionError(error instanceof Error ? error.message : '专辑资料暂时不可用'); })
      .finally(() => { if (!controller.signal.aborted) setAlbumDescriptionLoading(false); });
    return () => { controller.abort(); albumRequest.current?.abort(); };
  }, [selectedAlbumKey, album?.name, album?.artistName, kind]);
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
  const refreshAlbumDescription = async () => {
    if (!album) return;
    albumRequest.current?.abort();
    const controller = new AbortController();
    albumRequest.current = controller;
    const key = albumCacheKey(album);
    setAlbumDescriptionLoading(true);
    setAlbumDescriptionError('');
    try {
      const data = await fetchAlbumDescription(album, true, controller.signal);
      if (controller.signal.aborted || selectedAlbumKeyRef.current !== key) return;
      saveAlbumDescriptionCache(key, data);
      setAlbumDescription({ key, data });
    } catch (error) {
      if (!controller.signal.aborted && selectedAlbumKeyRef.current === key) setAlbumDescriptionError(error instanceof Error ? error.message : '专辑资料暂时不可用');
    } finally {
      if (!controller.signal.aborted && selectedAlbumKeyRef.current === key) setAlbumDescriptionLoading(false);
    }
  };
  const currentAlbumDescription = albumDescription?.key === selectedAlbumKey ? albumDescription.data : undefined;
  const albumPicture = currentAlbumDescription?.picture;
  useEffect(() => {
    if (!album || !albumPicture?.startsWith('/api/media/cover/')) return;
    const missing = album.tracks.filter(track => track.id > 0 && track.cover === '/covers/local.svg');
    if (!missing.length) return;
    let active = true;
    void Promise.allSettled(missing.map(track => backend.enrichment(track.id, albumPicture, '', '', true)))
      .then(results => {
        if (active && results.some(result => result.status === 'fulfilled')) window.dispatchEvent(new Event('lunanahida-library-changed'));
      });
    return () => { active = false; };
  }, [album, albumPicture]);
  const albumTracks = album?.tracks.map(track => albumPicture && track.cover === '/covers/local.svg' ? { ...track, cover: albumPicture } : track);
  const currentArtistDescription = artist && artistDescription?.name === artist.name ? artistDescription.data : undefined;
  const hasLongArtistDescription = !!currentArtistDescription && Array.from([
    currentArtistDescription.briefDesc,
    ...currentArtistDescription.introduction.map(section => section.txt),
  ].join('').trim()).length > 200;
  const visibleArtistTab = artistTab === 'info' && !hasLongArtistDescription ? 'albums' : artistTab;
  const artistCover = artist
    ? currentArtistDescription?.picture ?? artist.tracks.find(track => track.cover !== '/covers/local.svg')?.cover ?? artist.cover
    : detail?.cover ?? '/covers/local.svg';
  const artistInfo = artist && <section className="artist-description" aria-label="歌手介绍">
    <div className="artist-description-heading"><h2>歌手介绍</h2><button type="button" className="artist-description-refresh" onClick={() => void refreshArtistDescription()} disabled={artistDescriptionLoading}><RefreshCw size={14} className={artistDescriptionLoading ? 'animate-spin' : ''} />刷新资料</button></div>
    {artistDescriptionLoading && <p className="artist-description-status">正在加载歌手介绍…</p>}
    {artistDescriptionError && !artistDescriptionLoading && <p className="artist-description-status">{artistDescriptionError}</p>}
    {currentArtistDescription && <>
      {currentArtistDescription.briefDesc && <p className="artist-description-brief">{currentArtistDescription.briefDesc}</p>}
      {currentArtistDescription.introduction.map((section, index) => <section className="artist-description-section" key={`${section.ti}-${index}`}><h2>{section.ti}</h2><p>{section.txt}</p></section>)}
    </>}
  </section>;
  return <section className="catalog-page">
    {detail ? <>
      <Link className="playlist-back" to={kind === 'artists' ? '/artists' : '/albums'}><ArrowLeft size={16} /> 返回{label}</Link>
      <header className="catalog-hero"><img src={kind === 'artists' ? artistCover : currentAlbumDescription?.picture ?? detail.cover} alt="" /><div><span className="eyebrow"><span /> {kind === 'artists' ? 'ARTIST' : 'ALBUM'}</span><h1>{detail.name}</h1>
        {album && kind === 'albums' && <button className="catalog-text-link" onClick={() => onArtist(album.artistName)}>{album.artistName}</button>}
        {artist && kind === 'artists' && artist.aliases.length > 1 && <p>收录名称：{artist.aliases.join(' / ')}</p>}
        <p>{detail.tracks.length} 首歌曲{album && kind === 'albums' ? ` · ${yearValue(album.year) === null ? '未知年份' : album.year}` : ''}</p>
        <button type="button" className="playlist-primary" disabled={!detail.tracks.some(track => track.available !== false && track.playbackStatus !== 'unplayable')} onClick={() => onPlayTracks(album && kind === 'albums' ? albumTracks ?? album.tracks : detail.tracks)}><Play size={16} fill="currentColor" /> 播放</button>
      </div></header>
      {artist && kind === 'artists' && !hasLongArtistDescription && artistInfo}
      {artist && kind === 'artists' ? <>
        <div className="catalog-tabs" role="tablist" aria-label="歌手内容">
          <button type="button" role="tab" aria-selected={visibleArtistTab === 'albums'} className={visibleArtistTab === 'albums' ? 'active' : ''} onClick={() => setArtistTab('albums')}><Disc3 size={15} />专辑<span>{relatedAlbums.length}</span></button>
          <button type="button" role="tab" aria-selected={visibleArtistTab === 'songs'} className={visibleArtistTab === 'songs' ? 'active' : ''} onClick={() => setArtistTab('songs')}><ListMusic size={15} />歌曲<span>{artist.tracks.length}</span></button>
          {hasLongArtistDescription && <button type="button" role="tab" aria-selected={visibleArtistTab === 'info'} className={visibleArtistTab === 'info' ? 'active' : ''} onClick={() => setArtistTab('info')}><Info size={15} />歌手信息</button>}
        </div>
        {visibleArtistTab === 'albums' ? <div className="catalog-related"><div className="catalog-grid">{relatedAlbums.map(item => <button type="button" className="catalog-card" key={item.key} onClick={() => navigate(`/albums/${encodeURIComponent(item.artistKey)}/${encodeURIComponent(item.key)}`)}><span className="catalog-cover"><img src={item.cover} alt="" /><small className="catalog-cover-badge">{item.tracks.length} 首</small></span><strong>{item.name}</strong>{yearValue(item.year) !== null && <small>{item.year}</small>}</button>)}</div>{!relatedAlbums.length && <div className="library-empty"><Disc3 size={28} /><p>暂无专辑</p></div>}</div> : visibleArtistTab === 'songs' ? <div className="catalog-songs"><LibraryView key={`artist-${artist.key}`} title="歌曲" tracks={artist.tracks} currentId={currentId} liked={liked} playlists={playlists} onPlay={id => onPlayTracks(artist.tracks, id)} onPlayMany={onPlayTracks} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onRefreshInfo={onRefreshInfo} onSaveLyrics={onSaveLyrics} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum} /></div> : artistInfo}
      </> : album && kind === 'albums' ? <>
        <div className="catalog-tabs" role="tablist" aria-label="专辑内容">
          <button type="button" role="tab" aria-selected={albumTab === 'songs'} className={albumTab === 'songs' ? 'active' : ''} onClick={() => setAlbumTab('songs')}><ListMusic size={15} />歌曲<span>{album.tracks.length}</span></button>
          <button type="button" role="tab" aria-selected={albumTab === 'info'} className={albumTab === 'info' ? 'active' : ''} onClick={() => setAlbumTab('info')}><Info size={15} />专辑信息</button>
        </div>
        {albumTab === 'songs' ? <div className="catalog-songs"><LibraryView key={`${album.artistKey}-${album.key}`} title="歌曲" tracks={albumTracks ?? album.tracks} currentId={currentId} liked={liked} playlists={playlists} onPlay={id => onPlayTracks(albumTracks ?? album.tracks, id)} onPlayMany={onPlayTracks} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onRefreshInfo={onRefreshInfo} onSaveLyrics={onSaveLyrics} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum} /></div> : <section className="album-info" aria-label="专辑信息">
          <div className="artist-description-heading"><h2>专辑信息</h2><button type="button" className="artist-description-refresh" onClick={() => void refreshAlbumDescription()} disabled={albumDescriptionLoading}><RefreshCw size={14} className={albumDescriptionLoading ? 'animate-spin' : ''} />刷新资料</button></div>
          {albumDescriptionLoading && <p className="artist-description-status">正在加载专辑信息…</p>}
          {albumDescriptionError && !albumDescriptionLoading && <p className="artist-description-status">{albumDescriptionError}</p>}
          {currentAlbumDescription && <>
            <dl className="album-info-facts">
              <div><dt>专辑名称</dt><dd>{currentAlbumDescription.name}</dd></div>
              <div><dt>歌手</dt><dd>{currentAlbumDescription.artist}</dd></div>
              {currentAlbumDescription.type && <div><dt>类型</dt><dd>{currentAlbumDescription.type}</dd></div>}
              {currentAlbumDescription.subType && <div><dt>版本</dt><dd>{currentAlbumDescription.subType}</dd></div>}
              {currentAlbumDescription.publishTime && <div><dt>发行日期</dt><dd>{new Date(currentAlbumDescription.publishTime).toLocaleDateString('zh-CN')}</dd></div>}
              {currentAlbumDescription.company && <div><dt>发行公司</dt><dd>{currentAlbumDescription.company}</dd></div>}
              {currentAlbumDescription.size > 0 && <div><dt>曲目数</dt><dd>{currentAlbumDescription.size} 首</dd></div>}
              {currentAlbumDescription.aliases.length > 0 && <div><dt>别名</dt><dd>{currentAlbumDescription.aliases.join(' / ')}</dd></div>}
              {currentAlbumDescription.tags.length > 0 && <div><dt>标签</dt><dd>{currentAlbumDescription.tags.join(' / ')}</dd></div>}
              {currentAlbumDescription.commentCount !== undefined && <div><dt>评论</dt><dd>{currentAlbumDescription.commentCount.toLocaleString('zh-CN')}</dd></div>}
              {currentAlbumDescription.shareCount !== undefined && <div><dt>分享</dt><dd>{currentAlbumDescription.shareCount.toLocaleString('zh-CN')}</dd></div>}
            </dl>
            {currentAlbumDescription.description && <div className="album-info-description"><h3>专辑介绍</h3><p>{currentAlbumDescription.description}</p></div>}
            {currentAlbumDescription.songs.length > 0 && <div className="album-info-tracks"><h3>专辑收录曲目</h3><ol>{currentAlbumDescription.songs.map((song, index) => <li key={`${song.id}-${index}`}><span className="album-info-track-number">{song.number || index + 1}</span><span className="album-info-track-name"><strong>{song.name}</strong>{song.artist && <small>{song.artist}</small>}</span><span className="album-info-track-time">{formatTime(song.duration / 1000)}</span></li>)}</ol></div>}
          </>}
        </section>}
      </> : null}
    </> : <><header className="catalog-heading"><span className="eyebrow"><span /> YOUR COLLECTION</span><h1>{label}</h1><p>音乐库中共 {items.length} {kind === 'artists' ? '位歌手' : '张专辑'}</p></header>
      <div className="catalog-toolbar"><label className="catalog-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} aria-label={`搜索${label}`} placeholder={kind === 'artists' ? '搜索歌手名称' : '搜索专辑或歌手'} /></label><label className="catalog-sort"><ArrowDownAZ size={16} /><span>排序</span><select aria-label={`${label}排序`} value={kind === 'artists' ? artistSort : albumSort} onChange={event => kind === 'artists' ? setArtistSort(event.target.value as typeof artistSort) : setAlbumSort(event.target.value as typeof albumSort)}>{kind === 'artists' ? <><option value="added">添加时间</option><option value="name">名称</option><option value="tracks">歌曲数量</option></> : <><option value="added">添加时间</option><option value="year">发行年份</option><option value="name">专辑名称</option><option value="artist">歌手名称</option></>}</select></label></div>
      <div className="catalog-grid">{kind === 'artists' ? filteredArtists.map(item => <button type="button" className="catalog-card" key={item.key} onClick={() => navigate(`/artists/${encodeURIComponent(item.key)}`)}><span className="catalog-cover"><img src={item.cover} alt="" /><small className="catalog-cover-badge">{item.tracks.length} 首</small></span><strong>{item.name}</strong><small><Mic2 size={13} /> {albums.filter(albumItem => albumItem.artistKey === item.key).length} 张专辑</small></button>) : filteredAlbums.map(item => <button type="button" className="catalog-card" key={`${item.artistKey}-${item.key}`} onClick={() => navigate(`/albums/${encodeURIComponent(item.artistKey)}/${encodeURIComponent(item.key)}`)}><span className="catalog-cover"><img src={item.cover} alt="" /><small className="catalog-cover-badge">{item.tracks.length} 首</small></span><strong>{item.name}</strong><small><Users size={13} /> {item.artistName}{yearValue(item.year) === null ? '' : ` · ${item.year}`}</small></button>)}</div>
      {!items.length && <div className="library-empty"><Disc3 size={28} /><p>音乐库还没有歌曲</p></div>}
      {items.length > 0 && (kind === 'artists' ? filteredArtists.length : filteredAlbums.length) === 0 && <div className="library-empty"><Search size={25} /><p>没有找到匹配的{label}</p></div>}
    </>}
  </section>;
}
