export type Track = { id: number; title: string; english: string; artist: string; album: string; duration: number; cover: string; genre: string; year: string; color: string; source?: string; fileName?: string };

export const tracks: Track[] = [
  { id: 0, title: '风经过的地方', english: 'WHERE THE WIND GOES', artist: '青木 · Aoki', album: '山海之间', duration: 216, cover: '/covers/mountain.svg', genre: '氛围流行 / Ambient', year: '2025', color: '#9caeff' },
  { id: 1, title: '最后一班星际列车', english: 'THE LAST NIGHT TRAIN', artist: '星野遥 · Haruka', album: '午夜放映室', duration: 198, cover: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800&auto=format&fit=crop&q=85', genre: '电子 / Chillwave', year: '2025', color: '#d4a7db' },
  { id: 2, title: '森林来信', english: 'LETTERS FROM THE FOREST', artist: '森屿 · Forest Isle', album: '自然发生', duration: 243, cover: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&auto=format&fit=crop&q=85', genre: '自然 / New Age', year: '2024', color: '#a4c8b1' },
  { id: 3, title: '落日慢递', english: 'A SLOW SUNSET', artist: '橘子海岸', album: '橘色星期天', duration: 185, cover: 'https://images.unsplash.com/photo-1472120435266-53107fd0c44a?w=800&auto=format&fit=crop&q=85', genre: '轻音乐 / Lo-fi', year: '2025', color: '#e3b58e' },
  { id: 4, title: '月亮也失眠', english: 'SLEEPLESS MOON', artist: 'Luna & The Waves', album: '夜航日志', duration: 228, cover: 'https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?w=800&auto=format&fit=crop&q=85', genre: '梦幻流行 / Dream Pop', year: '2024', color: '#99bad4' },
  { id: 5, title: '等一场雨停', english: 'AFTER THE RAIN', artist: '青木 · Aoki', album: '山海之间', duration: 202, cover: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&auto=format&fit=crop&q=85', genre: '氛围流行 / Ambient', year: '2025', color: '#a5c8bf' },
];
export const lyricSets = [
 ['云轻轻掠过山的轮廓', '晚风吹散了喧嚣的颜色', '沿着河流，走过日落', '你说世界很大，慢慢来就好', '风经过的地方，有你的温柔', '把所有心事，都交给星河', '不必追问，明天的下落', '这一刻，让时间为我们停留', '山的那边，是另一片海', '我在风里，等一个未来', '让每颗星，都照亮你我', '在这片温柔里，自由地生活'],
 ['最后一班列车，驶向银河', '城市的灯，像闪烁的萤火', '窗外的夜色，轻轻经过', '把梦装进行囊，去远方漂泊', '下一站，会不会遇见你', '在星辰之间，留下足迹'],
 ['清晨的光，落在你的肩膀', '森林写来一封，绿色的信', '听见溪流，低声地歌唱', '每一片叶子，都藏着回响', '在树影之间，把呼吸放慢', '让心回到，最初的模样'],
 ['把今天折成一封信', '寄给橘色的天际', '落日慢慢地靠近', '海风吹过你的衣襟', '每一秒都值得珍惜', '明天也会有好天气'],
 ['月亮也失眠，在夜的边缘', '海浪翻过，昨天的书页', '星光陪着我，走得很远', '想念藏在，安静的时间', '等一声晚安，等一个晴天', '把梦轻轻，放在你身边'],
 ['等一场雨停，等一片天晴', '屋檐下的风铃，叮叮地回应', '街角的花，又开得透明', '有些美好，需要耐心', '让雨水洗去，昨日的心情', '然后微笑着，继续前行'],
];
export type LyricWord = { text: string; start: number; end: number };
const words = (text: string, start: number, step = .28): LyricWord[] => [...text].map((char, index) => ({ text: char, start: start + index * step, end: start + (index + 1) * step }));
export const wordLyricSets: LyricWord[][][] = lyricSets.map((lines, trackIndex) => lines.map((line, lineIndex) => words(line, lineIndex * (tracks[trackIndex].duration / (lines.length + 1)))));
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
