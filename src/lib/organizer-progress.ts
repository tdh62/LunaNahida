import type { OrganizerPlan, OrganizerProgress } from './backend';

export function organizerProgressPercent(progress: OrganizerProgress) {
  if (progress.phase === 'discover') return null;
  if (progress.phase === 'ready') return 100;
  if (progress.phase === 'group') return 99;
  const fraction = progress.quick || !progress.totalBytes ? progress.processed / Math.max(1, progress.total) : progress.bytes / progress.totalBytes;
  return Math.max(0, Math.min(98, Math.floor(fraction * 98)));
}

export async function readOrganizerPreview(response: Response, onProgress?: (progress: OrganizerProgress) => void): Promise<OrganizerPlan> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) return response.json();
  if (!response.body) throw new Error('无法读取扫描进度，请重新预览');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let plan: OrganizerPlan | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { progress?: OrganizerProgress; plan?: OrganizerPlan; error?: string };
    if (event.error) throw new Error(event.error);
    if (event.progress) onProgress?.(event.progress);
    if (event.plan) plan = event.plan;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffered.indexOf('\n')) >= 0) {
        consume(buffered.slice(0, boundary));
        buffered = buffered.slice(boundary + 1);
      }
      if (done) break;
    }
    consume(buffered);
    if (!plan) throw new Error('扫描中断，未生成预览，请重试');
    return plan;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
