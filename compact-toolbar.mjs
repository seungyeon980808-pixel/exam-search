// Relocate the existing controls: one state, one handler, at every viewport width.
export function mountCompactToolbar() {
  const $ = selector => document.querySelector(selector);
  const mobile = matchMedia('(max-width: 820px)');
  const toolbar = $('.topbar');
  const menu = $('#toolbar-menu-panel');
  const anchors = new Map();
  const relocate = (node, parent) => {
    if (!anchors.has(node)) {
      const anchor = document.createComment('compact-toolbar-home');
      node.before(anchor);
      anchors.set(node, anchor);
    }
    if (parent) { if (node.parentElement !== parent) parent.append(node); }
    else { const anchor = anchors.get(node); if (anchor.nextSibling !== node) anchor.after(node); }
  };
  const exportSlot = document.createElement('div');
  exportSlot.className = 'compact-export';
  $('#toolbar-menu').before(exportSlot);
  const editorMore = $('.editable-more-panel');
  for (const selector of ['#editable-reconvert', '#editable-view-settings', '#editable-information']) {
    editorMore.prepend($(selector));
  }

  const shortTitle = text => text.replace(/생명과학\s*/u, '생명').replace(/물리학\s*/u, '물리')
    .replace(/지구과학\s*/u, '지구').replace(/화학\s*/u, '화학');
  const syncTitle = () => {
    const heading = $('#detail-heading').textContent;
    $('#detail-compact-title').textContent = shortTitle(heading);
    $('.detail-info > summary').setAttribute('aria-label', heading ? `${heading} 정보와 문항 이동` : '문항 정보');
    const title = $('#editable-title').textContent;
    $('#editable-compact-title').textContent = title.startsWith('선택 문항') ? title.replace('선택 문항 ', '').replace('개', '문항') : '편집 문서';
    $('#editable-compact-title').title = title;
  };
  for (const selector of ['#detail-heading', '#editable-title']) {
    new MutationObserver(syncTitle).observe($(selector), { childList: true, characterData: true, subtree: true });
  }
  syncTitle();

  const sync = () => {
    for (const selector of ['#selection-toolbar', '#selection-tray', '.results-heading', '#applied-filters', '#tokens']) {
      relocate($(selector), mobile.matches ? menu : null);
    }
    // Keep conversion visible while reading; selection management lives in More.
    relocate($('#selection-open'), mobile.matches ? exportSlot : null);
    relocate($('#workspace-convert'), mobile.matches ? exportSlot : null);
    const files = $('.app-shell').classList.contains('is-files');
    exportSlot.classList.toggle('is-files', files);
    const title = $('#detail-heading').textContent;
    $('#detail-compact-title').textContent = mobile.matches ? shortTitle(title) : title;
  };
  mobile.addEventListener('change', () => { $('#toolbar-menu').open = false; sync(); });
  new MutationObserver(sync).observe($('.app-shell'), { attributes: true, attributeFilter: ['class'] });
  sync();

  const detailHeader = $('.detail-header');
  const details = [...detailHeader.querySelectorAll('details')];
  details.forEach(detail => detail.addEventListener('toggle', () => {
    if (detail.open) details.forEach(other => { if (other !== detail) other.open = false; });
  }));
  document.addEventListener('pointerdown', event => {
    if (!detailHeader.contains(event.target)) details.forEach(detail => { detail.open = false; });
  });
  detailHeader.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const opened = details.find(detail => detail.open);
    if (opened) { event.preventDefault(); event.stopPropagation(); opened.open = false; opened.querySelector('summary').focus(); }
  });
  $('#detail-results').addEventListener('click', () => $('#mobile-back').click());
  $('#detail-home').addEventListener('click', () => $('.brand').click());
  for (const selector of ['#mobile-back', '#previous-question', '#next-question', '#open-viewer', '#open-editable', '#detail-home']) {
    $(selector).addEventListener('click', () => details.forEach(detail => { detail.open = false; }));
  }
  // Moving a menu item into the toolbar must not leave its old popover open.
  $('#selection-open').addEventListener('click', () => { $('#toolbar-menu').open = false; });
  $('#editable-dialog').addEventListener('close', () => { sync(); });
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--compact-topbar-bottom', `${toolbar.getBoundingClientRect().bottom}px`);
  }).observe(toolbar);
}
