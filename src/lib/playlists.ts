export type Playlist = { id: string; name: string; description: string; trackIds: number[]; cover: string };

export const mockPlaylists: Playlist[] = [
  { id: 'night-drive', name: '深夜漫游', description: '城市安静下来以后，留给自己的时间。', trackIds: [1, 4, 0], cover: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800&auto=format&fit=crop&q=85' },
  { id: 'slow-afternoon', name: '慢慢的午后', description: '把步调放轻，让音乐陪你发一会儿呆。', trackIds: [3, 5, 2], cover: 'https://images.unsplash.com/photo-1472120435266-53107fd0c44a?w=800&auto=format&fit=crop&q=85' },
  { id: 'green-hours', name: '自然来信', description: '在风和树影之间，找回呼吸的节奏。', trackIds: [2, 0, 5], cover: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&auto=format&fit=crop&q=85' },
];
