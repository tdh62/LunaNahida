import { ArrowLeft, Disc3, ListMusic, Mic2, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LibraryView from '@/components/LibraryView';
import type { AlbumEntry, ArtistEntry } from '@/lib/catalog';
import type { Track } from '@/lib/music';
import type { Playlist } from '@/lib/playlists';

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
  onAddToPlaylist: (id: string, ids: number[]) => void;
  onArtist: (name: string) => void;
  onAlbum: (track: Track) => void;
};

export default function CatalogView({ kind, artists, albums, artist, album, currentId, liked, playlists, onPlay, onToggleLike, onViewInfo, onAddToPlaylist, onArtist, onAlbum }: Props) {
  const navigate = useNavigate();
  const detail = kind === 'artists' ? artist : album;
  const items = kind === 'artists' ? artists : albums;
  const label = kind === 'artists' ? '歌手' : '专辑';
  const relatedAlbums = artist ? albums.filter(item => item.artistKey === artist.key) : [];
  const [artistTab, setArtistTab] = useState<'albums' | 'songs'>('albums');
  return <section className="catalog-page">
    {detail ? <>
      <Link className="playlist-back" to={kind === 'artists' ? '/artists' : '/albums'}><ArrowLeft size={16} /> 返回{label}</Link>
      <header className="catalog-hero"><img src={detail.cover} alt="" /><div><span className="eyebrow"><span /> {kind === 'artists' ? 'ARTIST' : 'ALBUM'}</span><h1>{detail.name}</h1>
        {album && kind === 'albums' && <button className="catalog-text-link" onClick={() => onArtist(album.artistName)}>{album.artistName}</button>}
        {artist && kind === 'artists' && artist.aliases.length > 1 && <p>收录名称：{artist.aliases.join(' / ')}</p>}
        <p>{detail.tracks.length} 首歌曲{album && kind === 'albums' && album.year !== '—' ? ` · ${album.year}` : ''}</p>
        <button type="button" className="playlist-primary" onClick={() => onPlay(detail.tracks[0].id)}><Play size={16} fill="currentColor" /> 播放</button>
      </div></header>
      {artist && kind === 'artists' ? <>
        <div className="catalog-tabs" role="tablist" aria-label="歌手内容">
          <button type="button" role="tab" aria-selected={artistTab === 'albums'} className={artistTab === 'albums' ? 'active' : ''} onClick={() => setArtistTab('albums')}><Disc3 size={15} />专辑<span>{relatedAlbums.length}</span></button>
          <button type="button" role="tab" aria-selected={artistTab === 'songs'} className={artistTab === 'songs' ? 'active' : ''} onClick={() => setArtistTab('songs')}><ListMusic size={15} />歌曲<span>{artist.tracks.length}</span></button>
        </div>
        {artistTab === 'albums' ? <div className="catalog-related"><div className="catalog-grid">{relatedAlbums.map(item => <button type="button" className="catalog-card" key={item.key} onClick={() => navigate(`/albums/${encodeURIComponent(item.artistKey)}/${encodeURIComponent(item.key)}`)}><img src={item.cover} alt="" /><strong>{item.name}</strong><small>{item.tracks.length} 首歌曲 · {item.year}</small></button>)}</div>{!relatedAlbums.length && <div className="library-empty"><Disc3 size={28} /><p>暂无专辑</p></div>}</div> : <div className="catalog-songs"><LibraryView key={`artist-${artist.key}`} title="歌曲" tracks={artist.tracks} currentId={currentId} liked={liked} playlists={playlists} onPlay={onPlay} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum} /></div>}
      </> : <div className="catalog-songs"><h2>歌曲</h2><LibraryView key={`${kind}-${detail.name}`} title="歌曲" tracks={detail.tracks} currentId={currentId} liked={liked} playlists={playlists} onPlay={onPlay} onToggleLike={onToggleLike} onViewInfo={onViewInfo} onAddToPlaylist={onAddToPlaylist} onArtist={onArtist} onAlbum={onAlbum} /></div>}
    </> : <><header className="catalog-heading"><span className="eyebrow"><span /> YOUR COLLECTION</span><h1>{label}</h1><p>音乐库中共 {items.length} {kind === 'artists' ? '位歌手' : '张专辑'}</p></header>
      <div className="catalog-grid">{kind === 'artists' ? artists.map(item => <button type="button" className="catalog-card" key={item.key} onClick={() => navigate(`/artists/${encodeURIComponent(item.key)}`)}><img src={item.cover} alt="" /><strong>{item.name}</strong><small><Mic2 size={13} /> {item.tracks.length} 首歌曲</small></button>) : albums.map(item => <button type="button" className="catalog-card" key={`${item.artistKey}-${item.key}`} onClick={() => navigate(`/albums/${encodeURIComponent(item.artistKey)}/${encodeURIComponent(item.key)}`)}><img src={item.cover} alt="" /><strong>{item.name}</strong><small><Disc3 size={13} /> {item.artistName} · {item.tracks.length} 首</small></button>)}</div>
      {!items.length && <div className="library-empty"><Disc3 size={28} /><p>音乐库还没有歌曲</p></div>}
    </>}
  </section>;
}
