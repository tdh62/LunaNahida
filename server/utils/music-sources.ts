import { createHash, randomBytes } from 'node:crypto';
import { Converter } from 'opencc-js';
import { decryptEapi, eapi, weapi } from './ncm-crypto';

type Source = 'ncm' | 'qq';
type Song = { id: string; mid?: string; title: string; artist: string; artwork?: string };
export type Enrichment = { cover?: string; lyric?: string; translation?: string };

const cache = new Map<string, { value: unknown; expires: number; error?: boolean }>();
const pending = new Map<string, Promise<unknown>>();
const nextSlot: Record<Source, number> = { ncm: 0, qq: 0 };
const chains: Record<Source, Promise<void>> = { ncm: Promise.resolve(), qq: Promise.resolve() };
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const weapiUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.69';
const toSimplified = Converter({ from: 'tw', to: 'cn' });
let anonymousToken = '';
let queued = 0;

function limited<T>(source: Source, work: () => Promise<T>): Promise<T> {
  if (queued >= 24) return Promise.reject(new Error('请求队列已满'));
  queued++;
  const run = chains[source].then(async () => {
    const wait = Math.max(0, nextSlot[source] - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    nextSlot[source] = Date.now() + 1200;
    return work();
  });
  chains[source] = run.then(() => undefined, () => undefined);
  return run.finally(() => { queued--; });
}

export function cached<T>(key: string, ttl: number, load: () => Promise<T>, refresh = false): Promise<T> {
  const hit = cache.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.error ? Promise.reject(hit.value) : Promise.resolve(hit.value as T);
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const task = load().then(value => {
    if (cache.size >= 400) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }).catch(error => {
    if (cache.size >= 400) cache.delete(cache.keys().next().value!);
    cache.set(key, { value: error, expires: Date.now() + 15000, error: true });
    throw error;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

async function post(source: Source, url: string, body: string, headers: Record<string, string>) {
  return limited(source, async () => {
    const response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`上游返回 ${response.status}`);
    return response;
  });
}

async function token() {
  if (anonymousToken) return anonymousToken;
  return cached('ncm:anonymous', 6 * 60 * 60 * 1000, async () => {
    const device = 'NMUSIC';
    const xorKey = '3go8&$833h0k(2)2';
    const encoded = Buffer.from([...device].map((char, i) => String.fromCharCode(char.charCodeAt(0) ^ xorKey.charCodeAt(i % xorKey.length))).join(''));
    const username = Buffer.from(`${device} ${createHash('md5').update(encoded).digest('base64')}`).toString('base64');
    const response = await post('ncm', 'https://music.163.com/weapi/register/anonimous', weapi({ username, csrf_token: '' }).toString(), {
      'User-Agent': weapiUa, Referer: 'https://music.163.com', 'Content-Type': 'application/x-www-form-urlencoded',
    });
    const match = response.headers.get('set-cookie')?.match(/MUSIC_A=([^;]+)/);
    if (!match) throw new Error('无法获取网易云游客凭证');
    anonymousToken = match[1];
    return anonymousToken;
  });
}

async function ncm(url: string, data: Record<string, unknown>, mode: 'weapi' | 'eapi' = 'weapi', path = '') {
  const musicA = await token();
  const cookies = { __remember_me: true, _ntes_nuid: randomBytes(16).toString('hex'), NMTID: randomBytes(16).toString('hex'), MUSIC_A: musicA, os: 'ios', appver: '8.20.21' };
  let cookie = Object.entries(cookies).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('; ');
  let body: URLSearchParams;
  if (mode === 'weapi') body = weapi({ ...data, csrf_token: '' });
  else {
    const header = {
      osver: '17,1,2', deviceId: undefined, appver: cookies.appver, versioncode: '140', mobilename: undefined,
      buildver: String(Math.floor(Date.now() / 1000)), resolution: '1920x1080', __csrf: '', os: 'ios', channel: undefined,
      requestId: `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, '0')}`, MUSIC_A: musicA,
    };
    cookie = Object.entries(header).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('; ');
    body = eapi(path, { ...data, header });
  }
  const response = await post('ncm', url, body.toString(), {
    'User-Agent': mode === 'weapi' ? weapiUa : ua, Referer: 'https://music.163.com',
    'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie,
  });
  const result = mode === 'eapi' ? decryptEapi(Buffer.from(await response.arrayBuffer())) : await response.json();
  if (Number(result.code) !== 200) throw new Error(`网易云返回 ${result.code ?? '无效数据'}`);
  return result;
}

async function search(source: Source, query: string): Promise<Song[]> {
  if (source === 'ncm') {
    const result = await ncm('https://music.163.com/weapi/search/get', { s: query, type: 1, limit: 30, offset: 0 });
    if (!Array.isArray(result.result?.songs)) throw new Error('网易云搜索缺少歌曲列表');
    return result.result.songs.map((item: any) => ({
      id: String(item.id), title: item.name, artist: (item.artists ?? item.ar ?? []).map((a: any) => a.name).join(', '), artwork: item.album?.picUrl ?? item.al?.picUrl,
    }));
  }
  const response = await post('qq', 'https://u.y.qq.com/cgi-bin/musicu.fcg', JSON.stringify({ req_1: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { num_per_page: 20, page_num: 1, query, search_type: 0 } } }), {
    'User-Agent': ua, Referer: 'https://y.qq.com/', Cookie: 'uin=', 'Content-Type': 'application/json',
  });
  const payload = await response.json();
  const result = payload.req_1;
  if (!Array.isArray(result?.data?.body?.song?.list) || (result.code != null && Number(result.code) !== 0)) {
    throw new Error(`QQ 音乐搜索失败 (code=${String(payload.code ?? '-')}, reqCode=${String(result?.code ?? '-')}, bodyCode=${String(result?.data?.code ?? '-')}, songCount=${String(result?.data?.body?.song?.list?.length ?? '-')}, dataKeys=${Object.keys(result?.data ?? {}).join(',')})`);
  }
  return result.data.body.song.list.map((item: any) => ({
    id: String(item.id ?? item.songid), mid: item.mid ?? item.songmid, title: item.title ?? item.songname, artist: (item.singer ?? []).map((a: any) => a.name).join(', '),
    artwork: (item.album?.mid ?? item.albummid) ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${item.album?.mid ?? item.albummid}.jpg` : undefined,
  }));
}

function normalized(value: string) {
  return toSimplified(value.normalize('NFKC')).toLowerCase().replace(/\s+(?:[ivxlcdm]+|\d+)$/i, '').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function matches(song: Song, title: string, artist: string) {
  const wanted = normalized(artist);
  const names = song.artist.split(/[,，、/＆&;；]+/).map(normalized);
  return normalized(song.title) === normalized(title) && names.some(name => name === wanted);
}

async function lyrics(source: Source, song: Song): Promise<Pick<Enrichment, 'lyric' | 'translation'>> {
  if (source === 'ncm') {
    try {
      const result = await ncm('https://interface3.music.163.com/eapi/song/lyric/v1', { id: song.id, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 }, 'eapi', '/api/song/lyric/v1');
      return { lyric: result.lrc?.lyric ?? '', translation: result.tlyric?.lyric ?? '' };
    } catch {
      const result = await ncm('https://music.163.com/weapi/song/lyric', { id: song.id, lv: -1, tv: -1, cp: false, csrf_token: '' });
      return { lyric: result.lrc?.lyric ?? '', translation: result.tlyric?.lyric ?? '' };
    }
  }
  if (!song.mid) return {};
  const response = await limited('qq', () => fetch(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${new URLSearchParams({ songmid: song.mid!, g_tk: '5381', loginUin: '0', hostUin: '0', inCharset: 'utf8', outCharset: 'utf-8', notice: '0', platform: 'yqq', needNewCode: '0' })}`, { headers: { Referer: 'https://y.qq.com/', Cookie: 'uin=' }, signal: AbortSignal.timeout(12000) }));
  if (!response.ok) throw new Error(`上游返回 ${response.status}`);
  const text = (await response.text()).replace(/^(?:callback|MusicJsonCallback|jsonCallback)\(/, '').replace(/\)\s*;?\s*$/, '');
  const result = JSON.parse(text);
  if (result.retcode != null && Number(result.retcode) !== 0) throw new Error('QQ 音乐歌词不可用');
  const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8').replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity);
  return { lyric: result.lyric ? decode(result.lyric) : '', translation: result.trans ? decode(result.trans) : '' };
}

export type ArtistDescription = { id: string; name: string; picture?: string; briefDesc: string; introduction: { ti: string; txt: string }[] };

export async function getArtistDescription(name: string): Promise<ArtistDescription | null> {
  const result = await ncm('https://music.163.com/weapi/search/get', { s: toSimplified(name), type: 100, limit: 30, offset: 0 });
  const artists = result.result?.artists;
  if (!Array.isArray(artists)) throw new Error('网易云歌手搜索缺少结果');
  const target = normalized(name);
  const artist = artists.find((item: any) => [item.name, ...(item.alias ?? [])].some((candidate: string) => normalized(candidate) === target));
  if (!artist) return null;
  const description = await ncm('https://music.163.com/weapi/artist/introduction', { id: String(artist.id) });
  return {
    id: String(artist.id),
    name: artist.name,
    picture: typeof (artist.picUrl ?? artist.img1v1Url) === 'string' && /^https?:\/\/(?:p\d+\.music\.126\.net)\//.test(artist.picUrl ?? artist.img1v1Url) ? (artist.picUrl ?? artist.img1v1Url).replace(/^http:\/\//, 'https://') : undefined,
    briefDesc: description.briefDesc ?? '',
    introduction: Array.isArray(description.introduction) ? description.introduction.map((item: any) => ({ ti: String(item.ti ?? ''), txt: String(item.txt ?? '') })).filter((item: { ti: string; txt: string }) => item.ti || item.txt) : [],
  };
}

export async function enrich(title: string, artist: string, needCover: boolean, needLyrics: boolean, force = false): Promise<Enrichment> {
  const found: Enrichment = {};
  let failed = false;
  let matched = false;
  for (const source of ['ncm', 'qq'] as const) {
    if ((!needCover || found.cover) && (!needLyrics || found.lyric)) break;
    try {
      const lookup = (query: string) => force ? search(source, query) : cached(`search:v6:${source}:${normalized(query)}`, 60 * 60 * 1000, () => search(source, query));
      let song: Song | undefined;
      let candidates: Song[] = [];
      let lookupError: unknown;
      for (const query of [toSimplified(title), `${toSimplified(title)} ${toSimplified(artist)}`]) {
        try {
          candidates = await lookup(query);
          song = candidates.find(item => matches(item, title, artist));
          if (song) break;
        } catch (error) {
          lookupError = error;
          failed = true;
          console.warn(`音乐搜索失败 (${source}, ${query === toSimplified(title) ? '曲名' : '组合'}):`, error instanceof Error ? error.message : String(error));
          if (source === 'qq' && error instanceof Error && error.message.includes('reqCode=2001')) break;
        }
      }
      if (!song && !candidates.length && lookupError) throw lookupError;
      if (!song) console.info(`音乐未匹配 (${source}):`, { title, artist, candidates: candidates.slice(0, 8).map(item => ({ title: item.title, artist: item.artist })) });
      if (!song) continue;
      matched = true;
      if (needCover && !found.cover) {
        if (source === 'ncm' && !song.artwork) {
          try {
            const detail = await ncm('https://music.163.com/weapi/v3/song/detail', { c: JSON.stringify([{ id: Number(song.id) }]) });
            song.artwork = detail.songs?.[0]?.al?.picUrl ?? detail.songs?.[0]?.album?.picUrl;
          } catch (error) {
            failed = true;
            console.warn('网易云歌曲详情失败:', error instanceof Error ? error.message : String(error));
          }
        }
        if (song.artwork && /^https?:\/\/(?:p\d+\.music\.126\.net|y\.gtimg\.cn)\//.test(song.artwork)) found.cover = song.artwork.replace(/^http:\/\//, 'https://');
      }
      if (needLyrics && !found.lyric) {
        try {
          const result = force ? await lyrics(source, song) : await cached(`lyric:${source}:${song.id}:${song.mid ?? ''}`, 24 * 60 * 60 * 1000, () => lyrics(source, song));
          if (result.lyric) { found.lyric = result.lyric; found.translation = result.translation; }
        } catch (error) {
          failed = true;
          console.warn(`歌词补全失败 (${source}):`, error instanceof Error ? error.message : String(error));
        }
      }
      if ((needCover && !found.cover) || (needLyrics && !found.lyric)) console.info(`音乐资料不完整 (${source}):`, { title, artist, cover: !!found.cover, lyric: !!found.lyric });
    } catch (error) {
      failed = true;
      console.warn(`音乐搜索失败 (${source}):`, error instanceof Error ? error.message : String(error));
    }
  }
  if (failed && !found.cover && !found.lyric) throw new Error('音乐源暂时不可用');
  if (!matched && !failed) console.info('两个音乐源均未找到匹配:', { title, artist });
  return found;
}
