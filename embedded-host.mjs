const hosts = new Set(['https://www.5e.ai.kr', 'https://5e.ai.kr']);

// Only the trusted 5E wrapper receives bookmark state; standalone use is unchanged.
export function createEmbeddedHost(view) {
  let parentOrigin = '';
  const publish = () => {
    if (parentOrigin) view.parent.postMessage({ type: '5e:examlibrary-location',
      search: view.location.search, hash: view.location.hash }, parentOrigin);
  };
  if (view.parent === view) return publish;
  view.addEventListener('message', event => {
    if (event.source !== view.parent || !hosts.has(event.origin)
        || event.data?.type !== '5e:examlibrary-ready') return;
    parentOrigin = event.origin;
    publish();
  });
  return publish;
}
