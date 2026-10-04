import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export default async function verifyConversionWorkflow(setup, output, makeTrack) {
  const recovery = await setup({ backend: true, desktop: true, conversion: false });
  const page = recovery.page;
  let jobs = [{ path: 'C:/music/.lunanahida-convert-job-interrupted', source: 'C:/music/interrupted.qmc0', output: 'C:/music/interrupted.mp3', retired: 'C:/music/.lunanahida-retired-original', stage: 'published', sourceExists: false, outputExists: true, canRestore: true, canImport: true }];
  await page.route('**/api/conversion/jobs', route => route.fulfill({ json: jobs }));
  await page.route('**/api/conversion/recover', route => {
    assert.equal(route.request().postDataJSON().action, 'import');
    const track = makeTrack(31, 'Recovered Song');
    recovery.state.tracks = [track];
    jobs = [];
    return route.fulfill({ json: { source: 'C:/music/interrupted.qmc0', output: track.path, status: 'converted', track } });
  });
  await page.getByRole('button', { name: '音频工具箱', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '文件恢复', exact: true }).count(), 0);
  assert.ok(!recovery.requests.some(request => request.path === '/api/conversion/jobs'));
  await page.getByRole('button', { name: '格式还原', exact: true }).click();
  await page.getByText('未安装或无法使用加密音乐还原模块。安装后可开始还原；已有任务仍可在下方恢复文件。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '开始转换', exact: true }).count(), 0);
  await page.getByRole('button', { name: '文件恢复', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '格式还原', exact: true }).count(), 1);
  await page.getByRole('button', { name: '重新入库', exact: true }).click();
  await page.getByRole('button', { name: '确认重新入库', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.ok(!recovery.requests.some(request => request.path === '/api/conversion/recover'));
  await page.screenshot({ path: resolve(output, 'conversion-recovery-confirmation.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '确认重新入库', exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth), 'attached recovery must fit narrow windows');
  const dialogBounds = await page.getByRole('dialog').boundingBox();
  const playbackBounds = await page.locator('.playback-bar').boundingBox();
  assert.ok(dialogBounds.y + dialogBounds.height <= playbackBounds.y, 'recovery window must stay above playback controls');
  await page.screenshot({ path: resolve(output, 'conversion-recovery-mobile.png') });
  await page.getByRole('button', { name: '确认重新入库', exact: true }).click();
  await page.getByText('没有发现未完成任务。', { exact: false }).waitFor();
  assert.deepEqual(recovery.errors, []);
  await page.close();
  console.log('PASS interrupted restoration recovery: attached to restore task window, available without module, requires confirmation, reimports result and refreshes records');

  const batch = await setup({ backend: true, desktop: true });
  const batchPage = batch.page;
  const paths = ['C:/music/first.qmc0', 'C:/music/second.qmc0', 'C:/music/third.qmc0'];
  await batchPage.route('**/api/dialog/files', route => route.fulfill({ json: { paths } }));
  await batchPage.route('**/api/conversion/inspect', route => route.fulfill({ json: { paths, available: true } }));
  const attempts = new Map();
  let releaseSecond;
  let currentRequestID;
  await batchPage.route('**/api/conversion', async route => {
    const input = route.request().postDataJSON();
    const count = (attempts.get(input.path) || 0) + 1;
    attempts.set(input.path, count);
    if (input.path === paths[1] && count === 1) {
      currentRequestID = input.requestId;
      await new Promise(done => { releaseSecond = done; });
      await route.fulfill({ json: { source: input.path, status: 'cancelled', error: '已取消' } });
    } else if (input.path === paths[1] && count === 2) {
      await route.fulfill({ json: { source: input.path, status: 'failed', error: '测试文件需要重试' } });
    } else await route.fulfill({ json: { source: input.path, output: input.path.replace('.qmc0', '.mp3'), status: 'converted' } });
  });
  await batchPage.route('**/api/conversion/cancel', async route => {
    assert.equal(route.request().postDataJSON().requestId, currentRequestID);
    await route.fulfill({ json: { ok: true } });
    releaseSecond();
  });
  await batchPage.getByRole('button', { name: '打开歌曲', exact: true }).click();
  let releaseJobs;
  await batchPage.route('**/api/conversion/jobs', async route => {
    await new Promise(done => { releaseJobs = done; });
    await route.fulfill({ json: [] });
  });
  await batchPage.getByRole('button', { name: '文件恢复', exact: true }).click();
  await batchPage.getByText('正在检查或恢复…', { exact: true }).waitFor();
  assert.equal(await batchPage.getByRole('button', { name: '开始转换', exact: true }).isDisabled(), true);
  assert.equal(await batchPage.getByRole('button', { name: '返回工具箱', exact: true }).isDisabled(), true);
  await batchPage.keyboard.press('Escape');
  assert.equal(await batchPage.getByRole('dialog').count(), 1);
  releaseJobs();
  await batchPage.getByText('没有发现未完成任务。', { exact: false }).waitFor();
  await batchPage.screenshot({ path: resolve(output, 'conversion-attached-recovery.png') });
  await batchPage.getByRole('button', { name: '文件恢复', exact: true }).click();
  assert.equal(await batchPage.locator('.toolbox-item').count(), paths.length);
  await batchPage.unroute('**/api/conversion/jobs');
  await batchPage.route('**/api/conversion/jobs', route => route.fulfill({ json: [] }));
  await batchPage.getByRole('button', { name: '文件恢复', exact: true }).click();
  await batchPage.getByText('没有发现未完成任务。', { exact: false }).waitFor();
  await batchPage.getByRole('button', { name: '开始转换', exact: true }).click();
  await batchPage.getByText('正在还原 · 已处理 1 / 3', { exact: true }).waitFor();
  assert.equal(await batchPage.getByRole('button', { name: '文件恢复', exact: true }).isDisabled(), true);
  assert.equal(await batchPage.getByRole('button', { name: '刷新记录', exact: true }).isDisabled(), true);
  await batchPage.getByRole('button', { name: '取消还原', exact: true }).click();
  await batchPage.getByRole('button', { name: '继续剩余任务', exact: true }).waitFor();
  assert.equal(attempts.get(paths[0]), 1);
  assert.equal(attempts.get(paths[1]), 1);
  assert.equal(attempts.has(paths[2]), false);
  await batchPage.screenshot({ path: resolve(output, 'conversion-cancelled-progress.png') });
  await batchPage.getByRole('button', { name: '继续剩余任务', exact: true }).click();
  await batchPage.getByRole('button', { name: '仅重试失败项', exact: true }).waitFor();
  await batchPage.getByRole('button', { name: '仅重试失败项', exact: true }).click();
  await batchPage.getByText('本批已结束 · 已处理 1 / 1', { exact: true }).waitFor();
  assert.equal(attempts.get(paths[0]), 1);
  assert.equal(attempts.get(paths[1]), 3);
  assert.equal(attempts.get(paths[2]), 1);
  assert.deepEqual(batch.errors, []);
  await batchPage.close();
  console.log('PASS batch restoration: progress, cancellation, retained successes, remaining tasks and retry failures only');
}
