// This checks observed source assets, not the meaning of every PDF word or formula.
const validBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
  && box[2] > box[0] && box[3] > box[1];
const contains = (outer, inner) => validBox(outer) && validBox(inner)
  && outer[0] <= inner[0] + 0.6 && outer[1] <= inner[1] + 0.6
  && outer[2] >= inner[2] - 0.6 && outer[3] >= inner[3] - 0.6;

export function finalizeContentQuality(prepared, { includeImages = false, sourcePage = 1 } = {}) {
  const observed = Array.isArray(prepared?.contentRegions);
  const figures = (prepared?.blocks || []).flatMap((block) => block.runs || [])
    .filter((run) => run.kind === 'figure' && run.image?.bytes?.length && validBox(run.sourceBox));
  const regions = (observed ? prepared.contentRegions : []).map((value) => {
    const region = value && typeof value === 'object' ? value : {};
    const page = region.page || sourcePage;
    if (!validBox(region.box)) return { ...region, page, state: 'unresolved', reason: '자료 영역의 원본 위치를 확인할 수 없습니다.' };
    if (region.kind === 'table') {
      const present = region.id && prepared.blocks?.some((block) => block.kind === 'table' && block.sourceContentId === region.id);
      return { ...region, page, state: present ? 'editable' : 'unresolved',
        ...(present ? { reason: undefined } : { reason: '원본 자료표와 대응하는 편집 가능한 표가 없습니다.' }) };
    }
    if (!includeImages) return { ...region, page, state: 'excluded', reason: '그림 제외 옵션을 선택했습니다.' };
    const restored = figures.some((run) => (run.sourcePage || sourcePage) === page && contains(run.sourceBox, region.box));
    return { ...region, page, state: restored ? 'image' : 'unresolved',
      ...(restored ? { reason: undefined } : { reason: region.reason || '원본 자료 영역이 변환 문서에 포함되지 않았습니다.' }) };
  });
  const unresolvedCount = regions.filter((region) => region.state === 'unresolved').length;
  const excludedCount = regions.filter((region) => region.state === 'excluded').length;
  const failedFigureCount = includeImages ? (prepared?.notes || [])
    .filter((note) => /(?:그림|도표).*(?:제외했습니다|실패|초과)/u.test(note)).length : 0;
  const state = unresolvedCount || failedFigureCount ? 'incomplete' : !observed ? 'unverified' : excludedCount ? 'excluded' : 'review';
  const warnings = unresolvedCount
    ? [`원본 자료 ${unresolvedCount}개 영역의 복원을 확인해야 합니다. 원본 PDF와 대조하세요.`]
    : failedFigureCount ? ['그림 포함으로 변환했지만 일부 자료를 넣지 못했습니다. 원본 PDF와 대조하세요.']
      : !observed ? ['원본 자료의 포함 여부를 자동 대조하지 못했습니다. 원본 PDF와 확인하세요.']
      : excludedCount ? [`선택한 그림 제외 옵션으로 원본 자료 ${excludedCount}개 영역을 생략했습니다.`] : [];
  return { quality: { state, scope: 'observed-source-regions', regions, unresolvedCount, excludedCount, failedFigureCount }, warnings };
}

export function contentQualitySummary(items) {
  const results = items.flatMap((item) => item.result ? [item.result] : []);
  const incomplete = results.filter((result) => result.provenance === 'index-draft' || result.quality?.state === 'incomplete').length;
  const excluded = results.filter((result) => result.quality?.excludedCount > 0).length;
  const unverified = results.filter((result) => !result.quality || result.quality.state === 'unverified').length;
  const message = incomplete
    ? `복원 확인이 필요한 문항 ${incomplete}개가 있습니다. 문항 목록에서 빠진 자료와 경고를 확인하세요.`
    : excluded ? `그림 제외 옵션으로 자료를 생략한 문항 ${excluded}개가 있습니다. 본문·수식·보기는 편집 가능합니다.`
      : unverified ? `원본 자료 포함 여부의 확인이 필요한 문항 ${unverified}개가 있습니다. 원본 PDF와 대조하세요.`
        : '본문·수식·보기는 편집 가능합니다. 원본 PDF와 문장·수식·자료를 대조한 뒤 사용하세요.';
  const label = incomplete ? `복원 확인 ${incomplete}개 ⓘ` : excluded ? '그림 제외 · 원본 대조 ⓘ' : '편집 가능 · 원본 대조 ⓘ';
  return { incomplete, excluded, unverified, message, label };
}
