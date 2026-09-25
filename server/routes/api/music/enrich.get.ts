import { defineHandler } from 'nitro';
import { createError, getQuery } from 'nitro/h3';
import { cached, enrich } from '../../../utils/music-sources';

export default defineHandler(async event => {
  const { title, artist, cover, lyric, refresh } = getQuery(event);
  if (typeof title !== 'string' || typeof artist !== 'string' || !title.trim() || !artist.trim() || title.length > 120 || artist.length > 120 || (cover !== '0' && cover !== '1') || (lyric !== '0' && lyric !== '1') || (cover === '0' && lyric === '0') || (refresh !== undefined && refresh !== '1')) {
    throw createError({ statusCode: 400, statusMessage: '无效的曲目信息' });
  }
  try {
    if (refresh === '1') return await enrich(title.trim(), artist.trim(), cover === '1', lyric === '1', true);
    const key = `enrich:v5:${title.trim().normalize('NFKC').toLowerCase()}:${artist.trim().normalize('NFKC').toLowerCase()}:${cover}:${lyric}`;
    return await cached(key, 30 * 60 * 1000, () => enrich(title.trim(), artist.trim(), cover === '1', lyric === '1'));
  } catch {
    throw createError({ statusCode: 502, statusMessage: '音乐资料暂时不可用' });
  }
});
