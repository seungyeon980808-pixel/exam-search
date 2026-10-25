import { getJson } from './data.mjs?v=library-release-20261011-3';
import { resolveEditableContent } from './editable-source.mjs?v=frame-20261025-1';

const cache = new Map();
export function clearEditableBatchCache() { cache.clear(); }

export function createEditableBatch(ids, options = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id)
    || new Set(ids).size !== ids.length) throw new Error('문항 ID는 비어 있지 않은 중복 없는 목록이어야 합니다.');
  let items = ids.map((id) => ({ id, status: 'pending', question: null, result: null, error: null }));
  let cancelled = false;
  let running = false;
  const controller = new AbortController();
  const lookup = options.getQuestion || ((id) => getJson(`/api/question?id=${encodeURIComponent(id)}`));
  const resolve = options.resolve || resolveEditableContent;
  const includeImages = options.includeImages === true;
  const frame = options.frame !== false;
  const snapshot = () => ({ items: items.map((item) => ({ ...item })), cancelled,
    total: items.length, completed: items.filter((item) => ['ready', 'draft', 'error'].includes(item.status)).length });
  const report = () => { if (!cancelled) options.onProgress?.(snapshot()); };
  async function run(retry = false) {
    if (running) throw new Error('이미 준비 중입니다.');
    if (cancelled) return snapshot();
    running = true;
    try {
      const pending = items.filter((item) => retry ? item.status === 'error' : item.status === 'pending');
      for (const item of pending) {
        item.status = 'pending'; item.error = null;
        try {
          if (!item.question) {
            const question = await lookup(item.id);
            if (cancelled) return snapshot();
            if (question.id !== item.id) throw new Error('조회한 문항 ID가 일치하지 않습니다.');
            item.question = question;
          }
        } catch (error) {
          if (cancelled) return snapshot();
          item.status = 'error'; item.error = error instanceof Error ? error.message : String(error); report();
        }
      }
      const groups = new Map();
      for (const item of pending.filter((entry) => entry.status === 'pending')) {
        const key = item.question.pdfFile;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      // 문항 몇 개를 겹쳐 바꾼다(한 문항이 PDF 일꾼을 기다리는 동안 다른 문항의 그림을 찾는다). 시작 순서는 그대로.
      const queue = [...groups.values()].flat();
      const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 1));
      const worker = async () => { while (queue.length && !cancelled) await convert(queue.shift()); };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      return snapshot();
      async function convert(item) {
        if (cancelled) return;
        item.status = 'running'; report();
        if (cancelled) return;
        try {
          const cacheKey = JSON.stringify([item.id, includeImages, frame]);
          const cached = options.resolve ? null : cache.get(cacheKey);
          const result = cached ? structuredClone(cached) : await resolve(item.question, { signal: controller.signal, includeImages, frame,
            onPhase(message) { if (!cancelled) options.onPhase?.(message, item.question); } });
          if (cancelled) return;
          item.result = result;
          item.status = result.provenance === 'index-draft' ? 'draft' : 'ready';
          if (!options.resolve && result.quality?.state !== 'incomplete'
            && !(includeImages && result.warnings?.some((note) => /그림.*제외/u.test(note)))) {
            cache.delete(cacheKey); cache.set(cacheKey, structuredClone(result));
            if (cache.size > 64) cache.delete(cache.keys().next().value);
          }
        } catch (error) {
          if (cancelled) return;
          item.status = 'error'; item.error = error instanceof Error ? error.message : String(error);
        }
        report();
      }
    } finally { running = false; }
  }
  return { run: () => run(), retryFailed: () => run(true), snapshot,
    cancel() { cancelled = true; controller.abort(); items = items.map((item) => ({ ...item, result: null,
      status: ['pending', 'running'].includes(item.status) ? 'cancelled' : item.status })); },
  };
}
