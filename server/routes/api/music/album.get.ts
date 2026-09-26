import { defineHandler } from 'nitro';
import { createError, getQuery } from 'nitro/h3';
import { cached, getAlbumDescription } from '../../../utils/music-sources';

export default defineHandler(async event => {
  const { name, artist, refresh } = getQuery(event);
  if (typeof name !== 'string' || typeof artist !== 'string' || !name.trim() || !artist.trim() || name.length > 120 || artist.length > 120 || (refresh !== undefined && refresh !== '1')) {
    throw createError({ statusCode: 400, statusMessage: '无效的专辑信息' });
  }
  const key = `album-description:v1:${name.trim().normalize('NFKC').toLowerCase()}:${artist.trim().normalize('NFKC').toLowerCase()}`;
  try {
    const result = await cached(key, 10 * 365 * 24 * 60 * 60 * 1000, () => getAlbumDescription(name.trim(), artist.trim()), refresh === '1');
    if (!result) throw createError({ statusCode: 404, statusMessage: '网易云音乐中未找到匹配的专辑' });
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw createError({ statusCode: 502, statusMessage: '专辑资料暂时不可用' });
  }
});
