const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function detectSampleRate(bytes: Uint8Array): number | null {
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const u32le = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24;
  const u32be = (offset: number) => (bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  const plausible = (value: number) => value >= 8000 && value <= 384000 ? value : null;
  if (bytes.length >= 22 && text(0, 4) === 'fLaC') return plausible(bytes[18] << 12 | bytes[19] << 4 | bytes[20] >> 4);
  if (bytes.length >= 36 && text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') {
    for (let offset = 12; offset + 16 <= bytes.length;) {
      const size = u32le(offset + 4);
      if (text(offset, 4) === 'fmt ') return plausible(u32le(offset + 12));
      if (size < 0 || offset + size + 8 > bytes.length) break;
      offset += 8 + size + (size & 1);
    }
  }
  if (bytes.length >= 16 && text(0, 4) === 'OggS') {
    for (let offset = 0; offset + 16 < bytes.length; offset++) {
      if (text(offset, 8) === 'OpusHead') return 48000;
      if (bytes[offset] === 1 && text(offset + 1, 6) === 'vorbis') return plausible(u32le(offset + 12));
    }
    return null;
  }
  if (bytes.length >= 12 && text(4, 4) === 'ftyp') {
    for (let offset = 4; offset + 36 <= bytes.length; offset++) {
      if (text(offset, 4) !== 'mp4a') continue;
      const start = offset - 4, size = u32be(start);
      if (size < 36 || start + size > bytes.length) continue;
      const rate = u32be(start + 32) >>> 16;
      if (plausible(rate)) return rate;
    }
    return null;
  }
  let start = 0;
  if (bytes.length >= 10 && text(0, 3) === 'ID3') start = 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127);
  for (let offset = start; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
    const version = bytes[offset + 1] >> 3 & 3, layer = bytes[offset + 1] >> 1 & 3;
    const bitrate = bytes[offset + 2] >> 4, rateIndex = bytes[offset + 2] >> 2 & 3;
    if (version === 1 || layer === 0 || bitrate === 0 || bitrate === 15 || rateIndex === 3) continue;
    const base = [44100, 48000, 32000][rateIndex];
    return version === 3 ? base : version === 2 ? base / 2 : base / 4;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0) return rates[bytes[2] >> 2 & 15] ?? null;
  return null;
}
