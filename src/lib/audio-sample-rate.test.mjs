import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSampleRate } from './audio-sample-rate.ts';

test('reads sample rates from common local audio headers', () => {
  const flac = new Uint8Array(42);
  flac.set([102, 76, 97, 67]);
  flac[18] = 0x0a; flac[19] = 0xc4; flac[20] = 0x40;
  assert.equal(detectSampleRate(flac), 44100);

  const wav = new Uint8Array(44);
  wav.set([82, 73, 70, 70], 0); wav.set([87, 65, 86, 69], 8); wav.set([102, 109, 116, 32], 12);
  wav[16] = 16; wav[24] = 0x80; wav[25] = 0xbb;
  assert.equal(detectSampleRate(wav), 48000);

  assert.equal(detectSampleRate(Uint8Array.from([0xff, 0xfb, 0x90, 0x64])), 44100);
  assert.equal(detectSampleRate(Uint8Array.from([0xff, 0xf1, 0x50, 0x80])), 44100);
  assert.equal(detectSampleRate(new Uint8Array(16)), null);
});
