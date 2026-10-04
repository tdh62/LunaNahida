import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshQueue } from './refresh-queue.ts';

test('overlapping refreshes never publish a snapshot older than a pending change', async () => {
  const resolvers = [];
  const applied = [];
  const refresh = createRefreshQueue(() => new Promise(resolve => resolvers.push(resolve)), value => applied.push(value));
  const first = refresh();
  assert.equal(refresh(), first);
  await Promise.resolve();
  assert.equal(resolvers.length, 1);
  refresh();
  resolvers[0]('old');
  await Promise.resolve();
  assert.deepEqual(applied, []);
  assert.equal(resolvers.length, 2);
  resolvers[1]('new');
  await first;
  assert.deepEqual(applied, ['new']);
});

test('a failed refresh can be retried', async () => {
  let calls = 0;
  const applied = [];
  const refresh = createRefreshQueue(async () => { if (++calls === 1) throw new Error('offline'); return 'restored'; }, value => applied.push(value));
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.deepEqual(applied, ['restored']);
});
