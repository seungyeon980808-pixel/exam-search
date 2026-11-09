// print 단일 파일과 기출 탐색기가 함께 쓰는 주제 선택·범위 계산.
export function topicIds(value) {
  return Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean);
}
export function stableHash(value) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}
export function selectImyong(items, filters, {limit = true} = {}) {
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s/gu, '');
  const words = value => String(value || '').trim().split(/[\s,，#]+/u).filter(Boolean).map(normalize);
  const tokens = words(filters.q), excluded = words(filters.excludeKeywords), topics = topicIds(filters.topics);
  if (tokens.length > 3) throw Error('검색어는 세 단어까지 입력해 주세요.');
  if (+filters.yearFrom > +filters.yearTo) throw Error('시작 학년도를 끝 학년도보다 작게 골라 주세요.');
  const selected = items.filter(q => (!filters.subject || q.subject === filters.subject)
    && (!filters.domain || q.domain === filters.domain)
    && q.year >= +(filters.yearFrom || 2002) && q.year <= +(filters.yearTo || 2026)
    && (!filters.points ? [2,4].includes(q.points) : q.points === +filters.points)
    && (!filters.paperPart || q.paper === filters.paperPart)
    && (!topics.length || topics.some(id => q.topicIds?.includes(id)))
    && tokens.every(t => q._search.includes(t)) && !excluded.some(t => q._search.includes(t)));
  const base = (a,b) => (filters.sortMode === 'oldest' ? a.year-b.year : b.year-a.year) || a.subject.localeCompare(b.subject,'en') || a.paper.localeCompare(b.paper,'en') || a.order-b.order;
  const selectedTopic = q => q.topicIds?.find(t => !topics.length || topics.includes(t)) || '';
  const compare = filters.sortMode === 'random' ? ((a,b) => stableHash((filters.seed || '5e')+'\0'+a.id)-stableHash((filters.seed || '5e')+'\0'+b.id) || a.id.localeCompare(b.id,'en')) : filters.sortMode === 'topic' ? ((a,b) => selectedTopic(a).localeCompare(selectedTopic(b),'en') || base(a,b)) : base;
  selected.sort(compare);
  const result = limit && +filters.questionLimit ? selected.slice(0,+filters.questionLimit) : selected;
  return result.sort((a,b) => a.points-b.points || compare(a,b));
}
export function mountTopicPicker(container, taxonomy, {selected = [], subject = '', domain = '', onChange = () => {}} = {}) {
  let selection = new Set(topicIds(selected)), counts = {}, scope = {subject,domain};
  const heading = document.createElement('div');heading.className = 'topic-tools';
  const search = document.createElement('input');search.type='search';search.placeholder='단원·세부 주제 찾기';search.setAttribute('aria-label','단원·세부 주제 찾기');
  const clear = document.createElement('button');clear.type='button';clear.textContent='선택 해제';
  const state = document.createElement('output');state.setAttribute('aria-live','polite');
  heading.append(search,clear,state);
  const tree = document.createElement('div');tree.className='topic-tree';
  const note = document.createElement('p');note.className='topic-note';note.textContent='선택하지 않으면 전체 범위입니다. 여러 주제는 하나라도 해당하면 포함합니다. 원문 용어에 따른 자동 분류로, 경계 문항은 본문 검색과 미분류에서도 확인해 주세요.';
  container.replaceChildren(heading,tree,note);
  const visibleUnits = () => taxonomy.units.filter(u => (!scope.subject || u.subject===scope.subject || u.subject==='pedagogy') && (scope.domain==='pedagogy'?u.subject==='pedagogy':scope.domain==='content'?u.subject!=='pedagogy':true));
  const update = () => {
    state.textContent=selection.size ? `${selection.size}개 주제 선택` : '전체 범위';
    for (const details of tree.children) {
      const checks=[...details.querySelectorAll('[data-topic]')], unit=details.querySelector('[data-unit]');
      for (const c of checks) c.checked=selection.has(c.value);
      unit.checked=checks.length>0&&checks.every(c=>c.checked);unit.indeterminate=checks.some(c=>c.checked)&&!unit.checked;
    }
  };
  const find = () => {
    const term=search.value.normalize('NFKC').toLocaleLowerCase('ko').trim();
    for(const details of tree.children){let any=false;for(const row of details.querySelectorAll('.topic-option')){row.hidden=!!term&&!row.dataset.search.includes(term);if(!row.hidden)any=true;}details.hidden=!any;if(term&&any)details.open=true;}
  };
  const paint = () => {
    const units=visibleUnits(),allowed=new Set(units.flatMap(u=>u.topics.map(t=>t.id)));
    selection=new Set([...selection].filter(id=>allowed.has(id)));tree.replaceChildren();
    for (const u of units) {
      const details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent=({t_physics:'물리',t_chemistry:'화학',t_biology:'생물',t_earth:'지구과학',pedagogy:'과학교육론'}[u.subject])+' · '+u.label;details.append(summary);
      const allLabel=document.createElement('label');allLabel.className='topic-unit';const all=document.createElement('input');all.type='checkbox';all.dataset.unit=u.id;allLabel.append(all,document.createTextNode('이 단원 전체'));details.append(allLabel);
      all.onchange=()=>{for(const t of u.topics)all.checked?selection.add(t.id):selection.delete(t.id);update();onChange([...selection]);};
      for(const t of u.topics){const row=document.createElement('label');row.className='topic-option';row.dataset.search=(u.label+' '+t.label).normalize('NFKC').toLocaleLowerCase('ko');const c=document.createElement('input');c.type='checkbox';c.value=t.id;c.dataset.topic=t.id;const text=document.createElement('span');text.textContent=t.label;const count=document.createElement('small');count.dataset.count=t.id;count.textContent=counts[t.id]===undefined?'':`${counts[t.id]}문항`;row.append(c,text,count);details.append(row);c.onchange=()=>{c.checked?selection.add(t.id):selection.delete(t.id);update();onChange([...selection]);};}
      if(u.topics.some(t=>selection.has(t.id)))details.open=true;tree.append(details);
    }
    update();find();
  };
  clear.onclick=()=>{selection.clear();update();onChange([]);};search.oninput=find;paint();
  return {
    read:()=>[...selection],
    setScope(subject,domain){scope={subject,domain};paint();},
    setCounts(items){counts={};for(const q of items)for(const id of q.topicIds||[])counts[id]=(counts[id]||0)+1;for(const el of tree.querySelectorAll('[data-count]'))el.textContent=`${counts[el.dataset.count]||0}문항`;},
  };
}
