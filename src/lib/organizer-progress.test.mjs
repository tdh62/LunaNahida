import assert from 'node:assert/strict';
import test from 'node:test';
import { organizerProgressPercent, readOrganizerPreview } from './organizer-progress.ts';

const progress = { phase: 'scan', processed: 3, total: 10, current: '歌曲.flac', bytes: 50, totalBytes: 100, quick: false };
const plan = { id: 'preview', mode: 'deduplicate', matchMode: 'quick', scanned: 10, moves: [], groups: [], warnings: [] };
function streaming(chunks) {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
}

test('scan percentages cover unknown totals, bytes, quick counts and completion', () => {
  assert.equal(organizerProgressPercent({ ...progress, phase: 'discover' }), null);
  assert.equal(organizerProgressPercent(progress), 49);
  assert.equal(organizerProgressPercent({ ...progress, quick: true }), 29);
  assert.equal(organizerProgressPercent({ ...progress, phase: 'group' }), 99);
  assert.equal(organizerProgressPercent({ ...progress, phase: 'ready' }), 100);
  assert.equal(organizerProgressPercent({ ...progress, bytes: 200 }), 98);
  assert.equal(organizerProgressPercent({ ...progress, total: 0, processed: 0, totalBytes: 0 }), 0);
});

test('stream parses split UTF-8 characters and lines without waiting for the plan', async () => {
  const text = JSON.stringify({ progress }) + '\n\n' + JSON.stringify({ plan });
  const encoded = new TextEncoder().encode(text);
  const updates = [];
  const chunks = Array.from(encoded, byte => new Uint8Array([byte]));
  assert.deepEqual(await readOrganizerPreview(streaming(chunks), value => updates.push(value)), plan);
  assert.deepEqual(updates, [progress]);
});

test('stream reports server errors and incomplete or malformed responses', async () => {
  const encode = text => [new TextEncoder().encode(text)];
  await assert.rejects(readOrganizerPreview(streaming(encode('{"error":"路径不存在"}\n'))), /路径不存在/);
  await assert.rejects(readOrganizerPreview(streaming(encode(JSON.stringify({ progress }) + '\n'))), /扫描中断/);
  await assert.rejects(readOrganizerPreview(streaming(encode('not json\n'))), SyntaxError);
  await assert.rejects(readOrganizerPreview(new Response('{"error":"无效的整理操作"}', { status: 400 })), /无效的整理操作/);
});

test('existing JSON preview responses remain supported', async () => {
  assert.deepEqual(await readOrganizerPreview(Response.json(plan)), plan);
});

test('progress is delivered before a delayed final result', async () => {
  let controller;
  const updates = [];
  const response = new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  const pending = readOrganizerPreview(response, value => updates.push(value));
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ progress }) + '\n'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(updates.length, 1);
  controller.enqueue(new TextEncoder().encode(JSON.stringify({ plan }) + '\n'));
  controller.close();
  assert.deepEqual(await pending, plan);
});
