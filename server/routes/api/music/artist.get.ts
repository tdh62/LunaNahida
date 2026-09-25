import { defineHandler } from 'nitro';
import { createError, getQuery } from 'nitro/h3';
import { cached, getArtistDescription } from '../../../utils/music-sources';

export default defineHandler(async event => {
  const { name } = getQuery(event);
  if (typeof name !== 'string' || !name.trim() || name.length > 120) {
    throw createError({ statusCode: 400, statusMessage: '无效的歌手名称' });
  }
  const normalized = name.trim().normalize('NFKC').toLowerCase();
  try {
    const result = await cached(`artist-description:v1:${normalized}`, 24 * 60 * 60 * 1000, () => getArtistDescription(name.trim()));
    if (!result) throw createError({ statusCode: 404, statusMessage: '网易云音乐中未找到该歌手' });
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw createError({ statusCode: 502, statusMessage: '歌手介绍暂时不可用' });
  }
});
