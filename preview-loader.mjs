// Visible static previews must never wait behind PDF download/raster work.
export function createPreviewLoader({ staticLimit = 4, renderLimit = 2, rootMargin = '240px 0px' } = {}) {
  const tasks = new Map(), urls = new Map();
  let staticActive = 0, renderActive = 0, scheduled = false;
  const visible = task => {
    const rect = task.element.getBoundingClientRect();
    const pane = task.element.closest('.results-pane');
    const bounds = pane && getComputedStyle(pane).overflowY === 'auto' ? pane.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    return rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(innerHeight, bounds.bottom);
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const task = tasks.get(entry.target);
      if (!task) continue;
      task.near = entry.isIntersecting && !task.element.closest('[hidden]');
      if (!task.near) {
        if (task.state === 'queued') task.state = 'idle';
        task.controller?.abort();
      } else if (task.state === 'idle') task.state = 'queued';
    }
    schedule();
  }, { rootMargin });
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pump(); });
  }
  function nativeImage(task, source, signal) {
    return new Promise((resolve, reject) => {
      const image = task.image;
      const cleanup = () => { image.removeEventListener('load', load); image.removeEventListener('error', error); signal.removeEventListener('abort', abort); };
      const load = () => { cleanup(); resolve(); };
      const error = () => { cleanup(); reject(new Error('미리보기를 불러오지 못했습니다.')); };
      const abort = () => { cleanup(); image.removeAttribute('src'); reject(signal.reason); };
      image.addEventListener('load', load, { once: true }); image.addEventListener('error', error, { once: true });
      signal.addEventListener('abort', abort, { once: true });
      image.loading = 'eager'; image.decoding = 'async';
      image.fetchPriority = visible(task) ? 'high' : 'low';
      image.hidden = false; image.src = source;
      // A cache hit may already be complete before the listener's turn.
      if (image.complete && image.naturalWidth) load();
    });
  }
  function pump() {
    const queued = [...tasks.values()].filter(t => t.state === 'queued' && t.near && t.element.isConnected && !t.element.closest('[hidden]'));
    queued.sort((a,b) => Number(visible(b)) - Number(visible(a)));
    for (const task of queued) {
      const isStatic = !!task.source;
      if (isStatic ? staticActive >= staticLimit : renderActive >= renderLimit) continue;
      isStatic ? staticActive++ : renderActive++;
      task.state = 'loading';
      const controller = task.controller = new AbortController(), signal = controller.signal;
      void (async () => {
        let url;
        try {
          url = isStatic ? task.source : await task.render(signal);
          if (signal.aborted || tasks.get(task.element) !== task) {
            if (!isStatic && url) URL.revokeObjectURL(url);
            signal.throwIfAborted(); return;
          }
          if (!isStatic) urls.set(task.element, url);
          await nativeImage(task, url, signal);
          signal.throwIfAborted();
          if (tasks.get(task.element) !== task) return;
          task.state = 'ready'; task.placeholder?.remove();
          task.preview.classList.remove('is-loading', 'is-error');
          observer.unobserve(task.element);
        } catch (error) {
          if (signal.aborted || tasks.get(task.element) !== task) {
            // A card may re-enter before its cancelled load settles. Keep it eligible then.
            task.state = tasks.get(task.element) === task && task.near ? 'queued' : 'idle';
          } else if (isStatic && task.render) {
            // Missing/broken display assets still have the existing original-PDF fallback.
            task.source = ''; task.state = task.near ? 'queued' : 'idle';
          } else {
            task.state = 'error';
            task.preview.classList.remove('is-loading'); task.preview.classList.add('is-error');
            task.image.hidden = !task.preview.classList.contains('has-dimensions');
            if (task.placeholder) { task.placeholder.hidden = false; task.placeholder.textContent = '미리보기 실패 · 원본 PDF로 확인'; }
          }
          if (!isStatic && url) { URL.revokeObjectURL(url); urls.delete(task.element); }
        } finally {
          if (task.controller === controller) task.controller = null;
          isStatic ? staticActive-- : renderActive--;
          schedule();
        }
      })();
    }
  }
  function release(element) {
    observer.unobserve(element);
    const task = tasks.get(element);
    tasks.delete(element); task?.controller?.abort();
    const url = urls.get(element);
    if (url) URL.revokeObjectURL(url);
    urls.delete(element);
  }
  return {
    observe(task) { release(task.element); tasks.set(task.element, { ...task, state: 'idle', near: false, controller: null }); observer.observe(task.element); },
    release,
    clear() { observer.disconnect(); for (const element of tasks.keys()) release(element); },
  };
}
