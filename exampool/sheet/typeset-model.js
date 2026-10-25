import {exportLayoutHwpx,restackPictureLines} from './native-hwpx.js?v=frame-20261025-1';
export const PAPER_MM={A4:[210,297],B4:[257,364],A3:[297,420]};
export const LAYOUT_VERSION=13;
// 평가원 본문 글자: 장평 95%·자간 -5%(같은 글자 크기에서 한 줄에 약 10% 더 들어간다). 새로 조판하는 문항에만 건다.
import {nativeRuns} from './live-patch.js?v=frame-20261025-1';
import {KICE_STANDARD,layoutValues,standardForPaper} from './typeset-standard.js?v=frame-20261025-1';
// 본문 글자 장평·자간 기본값은 조판 기준(「수능 틀」)에서 읽는다.
export const TEXT_RATIO=KICE_STANDARD.text.ratio,TEXT_SPACING=KICE_STANDARD.text.spacing,TEXT_WIDTH=(TEXT_RATIO+TEXT_SPACING)/100;
const HU=7200/25.4;
export function pageProfile(profile={paper:'A4',columns:2},standard=KICE_STANDARD){
  if(!PAPER_MM[profile.paper]||![1,2].includes(profile.columns))throw Error('용지와 단 수를 확인하세요.');
  // B4·A3 2단은 단 폭을 평가원 원본(111.98mm)으로 맞춘 여백을 쓴다(standardForPaper, 10-24 용지 원칙) — 문항 조판·시험지 묶기·검사가 같은 값을 쓴다.
  const [w,h]=PAPER_MM[profile.paper],L=layoutValues(profile.columns===2?standardForPaper(standard,profile.paper):standard),margin=L.margin,spacing=L.columnGap;
  return {page:{width:Math.round(w*HU),height:Math.round(h*HU),marginLeft:Math.round(margin.left*HU),marginRight:Math.round(margin.right*HU),marginTop:Math.round(margin.top*HU),marginBottom:Math.round(margin.bottom*HU),marginHeader:0,marginFooter:0,marginGutter:0,landscape:false},spacing:Math.round(spacing*HU),width:Math.floor(((w-margin.left-margin.right-(profile.columns-1)*spacing)/profile.columns)*HU/75)-8};
}
// 한글 문서에 실제로 나오는 값: 번호·유형·선지 표현·발문·구성·선지·선지표·선지 배열·[3점].
// 단원·성취기준·정답·배점·출처·해설·문항 상태는 조판에 영향이 없으므로 바꿔도 한글 창을 다시 그리지 않는다.
// 배점은 3점일 때만 [3점]으로 찍힌다. 그때만 지문에 넣어 다른 문항의 저장한 조판 지문은 그대로 둔다.
export const renderedContent=q=>({standardId:q.standardId,askGap:q.askGap,choicesGap:q.choicesGap,number:q.number,type:q.type,style:q.style,ask:q.ask,blocks:q.blocks,choices:q.choices,choiceTable:q.choiceTable,choiceLayout:q.choiceLayout,...(q.points===3?{pointsMark:3}:{})});
const sha256=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const questionFingerprint=q=>sha256(JSON.stringify(renderedContent(q)));
// 이전 판은 조판과 상관없는 칸까지 지문에 넣었다. 그때 저장한 조판도 내용이 같으면 그대로 인정한다.
const legacyFingerprint=q=>{const {typeset,references,workflow,...rest}=q;return sha256(JSON.stringify(rest));};
export async function typesetMatches(typeset,q){return !!typeset&&(typeset.fingerprint===await questionFingerprint(q)||typeset.fingerprint===await legacyFingerprint(q));}
export const toBase64=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=32768)raw+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(raw);};
export const fromBase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export const mathParts=value=>String(value).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\{\{수식:[\s\S]+?\}\})/g).filter(Boolean).map(text=>{
  const math=text.startsWith('$')||text.startsWith('\\(')||text.startsWith('{{수식:');
  return {math,text:math?text.startsWith('$$')?text.slice(2,-2):text.startsWith('$')?text.slice(1,-1):text.startsWith('\\(')?text.slice(2,-2):text.slice(5,-2):text};
});

// 표 바깥 여백(왼·오)을 0으로 바꾸고, 엔진이 표를 넣을 때 그 여백만큼 줄여 둔 폭을 표 폭과 각 줄 마지막 칸 폭에 되돌린다.
// 되돌리지 않으면 표가 계획보다 약 8px 좁고 4px 안쪽에 놓여 〈보기〉·상자가 단 끝에 닿지 않고 마지막 선지가 넘쳤다(10-25 실측 30600 → 30000).
export function widenTablesByMargins(xml){
  xml=xml.replace(/<hp:tbl\b[\s\S]*?(?=<hp:tr>)/g,head=>{const m=head.match(/<hp:outMargin\b[^>]*>/)?.[0]||'',add=Number(m.match(/\bleft="(\d+)"/)?.[1]||0)+Number(m.match(/\bright="(\d+)"/)?.[1]||0);
    let h=head.replace(/<hp:outMargin\b[^>]*>/,mm=>mm.replace(/\b(left|right)="\d+"/g,'$1="0"'));
    if(add>0)h=h.replace(/<hp:sz\b([^>]*?)\bwidth="(\d+)"/,(t,pre,w)=>`<hp:sz${pre}width="${Number(w)+add}"`).replace(/^<hp:tbl\b/,`<hp:tbl data-widen="${add}"`);
    return h;});
  if(!xml.includes('data-widen='))return xml;
  const stack=[];let cell=null;
  xml=xml.replace(/<hp:tbl\b[^>]*>|<\/hp:tbl>|<hp:cellAddr\b[^>]*>|<hp:cellSpan\b[^>]*>|<hp:cellSz\b[^>]*>/g,tag=>{
    if(tag.startsWith('<hp:tbl')){stack.push({add:Number(tag.match(/data-widen="(\d+)"/)?.[1]||0),cols:Number(tag.match(/\bcolCnt="(\d+)"/)?.[1]||0)});cell=null;return tag;}
    if(tag==='</hp:tbl>'){stack.pop();cell=null;return tag;}
    const t=stack.at(-1);if(!t)return tag;
    if(tag.startsWith('<hp:cellAddr')){cell={c:Number(tag.match(/\bcolAddr="(\d+)"/)?.[1]||0),span:1};return tag;}
    if(tag.startsWith('<hp:cellSpan')){if(cell)cell.span=Number(tag.match(/\bcolSpan="(\d+)"/)?.[1]||1);return tag;}
    if(cell&&t.add>0&&cell.c+cell.span===t.cols){const out=tag.replace(/\bwidth="(\d+)"/,(x,w)=>`width="${Number(w)+t.add}"`);cell=null;return out;}
    cell=null;return tag;});
  return xml.replace(/ data-widen="\d+"/g,'');
}
export async function normalizeQuestionImport(bytes,JSZip,{standard=KICE_STANDARD}={}){
  const L=layoutValues(standard);
  const zip=await JSZip.loadAsync(new Uint8Array(bytes));
  // The HTML importer adds a 20px indent to table anchor paragraphs, and
  // parses CSS cell padding but leaves hasMargin off. Correct only this newly
  // generated question document, before the user starts editing its layout.
  let header=await zip.file('Contents/header.xml').async('string');
  header=header.replace(/<hc:(left|right|intent) value="\d+"/g,'<hc:$1 value="0"');
  // 한글 줄 나눔은 평가원처럼 어절 단위. HWPX에서는 BREAK_WORD가 「어절」(rhwp koreanBreakUnit 0), KEEP_WORD가 「글자」다
  // (10-22 실험: KEEP_WORD로 바꾸던 예전 코드가 거꾸로 글자 단위로 만들어 「설계|한다」처럼 어절 가운데에서 끊겼다).
  header=header.replace(/breakNonLatinWord="KEEP_WORD"/g,'breakNonLatinWord="BREAK_WORD"');
  header=header.replace(/<hh:ratio\b[^>]*\/>/g,tag=>tag.replace(/="\d+"/g,`="${L.ratio}"`)).replace(/<hh:spacing\b[^>]*\/>/g,tag=>tag.replace(/="-?\d+"/g,`="${L.spacing}"`));
  // 좁힌 줄(10-25): 조판이 글자색 #0A0BNN(NN = 더 좁힐 자간 %)으로 표시한 글자 모양은 자간을 그만큼 더 좁히고 검은색으로 되돌린다.
  // 평가원 원본은 칸·〈보기〉 줄의 낱말이 조금 넘치면 그 줄 자간을 좁혀 한 줄에 넣는다. 한글 엔진의 HTML 읽기는 letter-spacing을 받지 않는다.
  header=header.replace(/<hh:charPr\b[^>]*textColor="#0A0B([0-9A-F]{2})"[^>]*>[\s\S]*?<\/hh:charPr>/gi,(m,nn)=>m.replace(/textColor="#0A0B[0-9A-F]{2}"/i,'textColor="#000000"').replace(/<hh:spacing\b[^>]*\/>/,tag=>tag.replace(/="-?\d+"/g,`="${L.spacing-parseInt(nn,16)}"`)));
  // 학교 기준(10-22 S4): 본문 글꼴·글자 크기·줄 간격을 기준 값으로. 크기는 모든 글자 모양을 같은 비율로(11pt 기준), 글꼴은 본문 함초롬바탕만,
  // 줄 간격은 본문 160%만(표 칸 130%·〈보기〉 150%는 그대로). 수능 틀이면 손대지 않는다(바이트 동일).
  if(standard&&standard.id!==KICE_STANDARD.id){
    const T=standard.text||{},scale=(T.size||11)/11;
    // 글자 크기는 조판(handoff)이 틀 값(text.size)으로 이미 넣는다(10-25) — 여기서 다시 키우지 않는다.
    void scale;
    if(T.font&&T.font!=='함초롬바탕')header=header.replace(/face="함초롬바탕"/g,`face="${T.font.replace(/[&<>"]/g,'')}"`);
    if(T.lineSpacing&&T.lineSpacing!==160)header=header.replace(/(<hh:lineSpacing type="PERCENT" value=")160"/g,`$1${Math.round(T.lineSpacing)}"`);
    // 조판 설정(10-23): 한글 줄 나눔 「글자」, 본문 정렬 「왼쪽」을 고르면 바꾼다(기본은 어절·양쪽).
    if(T.break==='char')header=header.replace(/breakNonLatinWord="BREAK_WORD"/g,'breakNonLatinWord="KEEP_WORD"');
    if(T.align==='left')header=header.replace(/(<hh:align\b[^>]*horizontal=")JUSTIFY"/g,'$1LEFT"');
  }
  let xml=await zip.file('Contents/section0.xml').async('string');
  // Center the table's anchor paragraph, including nested tables. Cell text
  // alignment alone does not position an inline table. Clone the styles so
  // neighboring prose keeps its own alignment.
  const styles=new Map([...header.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"[\s\S]*?<\/hh:paraPr>/g)].map(m=>[m[1],m[0]]));
  let nextId=Math.max(...[...styles.keys()].map(Number))+1;const clones=new Map(),stack=[],anchors=new Set();
  for(const token of xml.matchAll(/<hp:p\b[^>]*>|<\/hp:p>|<hp:tbl\b/g)){
    if(token[0].startsWith('<hp:p '))stack.push(token.index);
    else if(token[0]==='</hp:p>')stack.pop();
    else if(stack.length)anchors.add(stack.at(-1));
  }
  xml=xml.replace(/<hp:p\b[^>]*>/g,(tag,offset)=>{
    if(!anchors.has(offset))return tag;
    const old=tag.match(/paraPrIDRef="(\d+)"/)?.[1];
    if(!styles.has(old))throw Error('표 위치를 지정할 문단을 찾지 못했습니다.');
    if(!clones.has(old)){const id=String(nextId++);clones.set(old,id);const style=styles.get(old).replace(/\bid="\d+"/,`id="${id}"`).replace(/horizontal="[^"]*"/,'horizontal="CENTER"');header=header.replace('</hh:paraProperties>',style+'</hh:paraProperties>');}
    return tag.replace(/paraPrIDRef="\d+"/,`paraPrIDRef="${clones.get(old)}"`);
  });
  // 표 칸의 가운데 문단(자료표 칸 글)은 줄 간격 130%로. HTML의 line-height는 한글 엔진이 받지 않아 모두 160%로 들어온다.
  // 표를 품은 문단(겹친 표 자리)은 그대로 둔다.
  const spacing=new Map();{const open=[];let depth=0;const marks=[];
    for(const token of xml.matchAll(/<hp:subList\b[^>]*>|<\/hp:subList>|<hp:p\b[^>]*>|<\/hp:p>|<hp:tbl\b/g)){
      const t=token[0];
      if(t.startsWith('<hp:subList'))depth++;else if(t==='</hp:subList>')depth--;
      else if(t.startsWith('<hp:p ')){open.push({index:token.index,tag:t,depth,table:false});}
      else if(t==='</hp:p>'){const p=open.pop();if(p&&p.depth>0&&!p.table)marks.push(p);}
      else if(open.length)open.at(-1).table=true;
    }
    const center=new Set([...styles.entries()].filter(([,v])=>/horizontal="CENTER"/.test(v)).map(([k])=>k));
    for(const p of marks.sort((a,b)=>b.index-a.index)){
      const old=p.tag.match(/paraPrIDRef="(\d+)"/)?.[1];if(!center.has(old))continue;
      if(!spacing.has(old)){const id=String(nextId++);spacing.set(old,id);header=header.replace('</hh:paraProperties>',styles.get(old).replace(/\bid="\d+"/,`id="${id}"`).replace(/(<hh:lineSpacing type="PERCENT" value=")\d+/g,'$1'+L.tableLineSpacing)+'</hh:paraProperties>');}
      xml=xml.slice(0,p.index)+p.tag.replace(/paraPrIDRef="\d+"/,`paraPrIDRef="${spacing.get(old)}"`)+xml.slice(p.index+p.tag.length);
    }
  }
  header=header.replace(/(<hh:paraProperties\b[^>]*itemCnt=")\d+"/,`$1${styles.size+clones.size+spacing.size}"`);
  zip.file('Contents/header.xml',header);
  xml=xml.replace(/<hp:tc\b[^>]*>/g,tag=>tag.replace(/hasMargin="0"/,'hasMargin="1"'));
  xml=widenTablesByMargins(xml);
  // 한 줄 선지 칸(①~⑤로 시작, 줄바꿈 없음)은 좌우 안 여백 0 — 평가원은 탭으로 띄워 ①이 〈보기〉 왼쪽 끝과 맞는다(엔진은 여백 0을 기본값 141로 바꿔 2px 들어갔다).
  xml=xml.replace(/<hp:tc\b[^>]*>(?:(?!<\/hp:tc>)[\s\S])*?<\/hp:tc>/g,tc=>/^[^]*?<hp:t>[①-⑤]/.test(tc)&&!/<hp:lineBreak\/>/.test(tc)&&!/<hp:tbl\b/.test(tc)?tc.replace(/<hp:cellMargin\b([^>]*)>/,(m,a)=>`<hp:cellMargin${a.replace(/\b(left|right)="\d+"/g,'$1="0"')}>`):tc);
  // 가운데 그림 문단의 빠진 줄 배치를 채운다(없으면 다시 열 때 그림이 사라진다).
  xml=restackPictureLines(xml);
  zip.file('Contents/section0.xml',xml);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

// 자료 표·그림이 있는 문단(글이 없는 문단)도 찾는다.
const controlParas=(document,sec)=>{const set=new Set();for(let p=0;p<document.pageCount();p++)for(const c of JSON.parse(document.getPageControlLayout(p)).controls||[])if(c.secIdx===sec&&!(c.cellPath||[]).length)set.add(c.paraIdx);return [...set];};
// 상자·묶음 칸 안 그림 가운데(사용자 결정: 그림은 무조건 가운데). HTML에서 칸 안 그림을 가운데 문단으로 감싸면 한글 엔진이 줄 배치를 빠뜨리므로,
// 한글 문서를 만든 뒤 칸 안에서 '그림만 있는 문단'의 정렬만 가운데로 바꾼다. 글과 함께 있는 그림·떠 있는 그림은 건드리지 않는다.
export function centerCellPictures(document){
  const key=(s,p,path)=>`${s}:${p}:${JSON.stringify((path||[]).map(c=>[c.controlIndex??c.controlIdx,c.cellIndex??c.cellIdx,c.cellParaIndex??c.cellParaIdx]))}`;
  const texted=new Set(),targets=new Map();
  for(let page=0;page<document.pageCount();page++){
    for(const r of JSON.parse(document.getPageTextLayout(page)).runs||[])if(r.cellPath?.length&&String(r.text||'').trim())texted.add(key(r.secIdx,r.paraIdx,r.cellPath));
    const layout=document.getPageControlLayout(page),controls=(typeof layout==='string'?JSON.parse(layout):layout).controls||[];
    for(const c of controls)if(c.type==='image'&&c.cellPath?.length===1)targets.set(key(c.secIdx,c.paraIdx,c.cellPath),c);
  }
  let n=0;
  for(const [k,c] of targets){if(texted.has(k))continue;const cell=c.cellPath[0];
    try{document.applyParaFormatInCell(c.secIdx,c.paraIdx,cell.controlIndex??cell.controlIdx,cell.cellIndex??cell.cellIdx,cell.cellParaIndex??cell.cellParaIdx,JSON.stringify({alignment:'center'}));n++;}catch{}}
  if(n)document.reflowLinesegs?.();
  return n;
}
export function applyQuestionIndent(document,number,{body=false,askLead='',askIndent=0,hangPx=0}={}){
  if(!number)return;
  const prefix=`${number}. `;
  for(let page=0;page<document.pageCount();page++){
    // 번호를 굵게 따로 찍으면(10-24) 「7.」이 혼자 한 조각이 된다 — 그 조각도 번호로 본다.
    const isNo=r=>r.text.startsWith(prefix)||r.text===`${number}.`;
    const run=JSON.parse(document.getPageTextLayout(page)).runs.find(r=>r.charStart===0&&isNo(r)||!r.cellPath?.length&&isNo(r));
    if(!run)continue;
    // 글 옆 자료처럼 번호가 표 칸 안에 있으면 칸 문단은 내어쓰기를 건드리지 않는다.
    if(run.cellPath?.length)return;
    // 어울림 그림이 문단 맨 앞에 있으면 번호 글은 그 뒤에서 시작한다.
    const at=run.charStart||0,start=JSON.parse(document.getCursorRect(run.secIdx,run.paraIdx,at)),end=JSON.parse(document.getCursorRect(run.secIdx,run.paraIdx,at+prefix.length)),hang=hangPx>0?Math.round(hangPx*150):Math.round((end.x-start.x)*150);
    document.applyParaFormat(run.secIdx,run.paraIdx,JSON.stringify({indent:-hang}));
    // 평가원 지면: 번호 다음 문단(자료 표·발문·<보기>·선지)은 모두 번호 너비만큼 들어가 시작한다. 발문 첫 줄은 한 글자 더.
    if(body){
      const lead=String(askLead||'').replace(/\s+/g,''),count=document.getParagraphCount?.(run.secIdx);
      const texts=new Map();for(let p=0;p<document.pageCount();p++)for(const r of JSON.parse(document.getPageTextLayout(p)).runs)if(!r.cellPath?.length&&r.secIdx===run.secIdx)texts.set(r.paraIdx,(texts.get(r.paraIdx)||'')+r.text);
      const last=Number.isInteger(count)?count-1:Math.max(run.paraIdx,...texts.keys(),...controlParas(document,run.secIdx));
      for(let para=run.paraIdx+1;para<=last;para++){
        const isAsk=!!lead&&String(texts.get(para)||'').replace(/\s+/g,'').startsWith(lead);
        document.applyParaFormat(run.secIdx,para,JSON.stringify(isAsk?{marginLeft:hang,indent:Math.round(askIndent*150)}:{marginLeft:hang}));
      }
    }
    document.reflowLinesegs();return;
  }
  throw Error('문항 번호 뒤의 들여쓰기 위치를 찾지 못했습니다.');
}

// Set defaults only on a newly imported question, never on a saved layout.
// CSS and native setters scale cell indents differently. Measure the real
// label, then clone its HWPX paragraph style; this also handles nested boxes,
// which the pinned engine's paragraph-format command does not support.
export async function applyReferenceBogiIndent(document,JSZip,CFB=globalThis.XLSX?.CFB){
  const runs=[];
  for(let page=0;page<document.pageCount();page++)runs.push(...JSON.parse(document.getPageTextLayout(page)).runs);
  const tableKey=r=>JSON.stringify([r.secIdx,r.parentParaIdx,r.cellPath.slice(0,-1),r.cellPath.at(-1).controlIndex]);
  const boxes=new Set(runs.filter(r=>r.cellPath?.length&&r.text==='<보 기>').map(tableKey)),indents=new Map();
  const paraKey=(sec,parent,path)=>JSON.stringify([sec,parent,path]);
  // 한 문단 앞부분이 여러 조각으로 올 수 있다(「(」만 따로 · 「다) …」 — 10-24 11번). 같은 문단 조각을 이어 앞머리를 찾는다.
  const heads=new Map();for(const r of runs){if(!r.cellPath?.length)continue;const k=JSON.stringify([r.secIdx,r.parentParaIdx,r.cellPath]);heads.set(k,[...(heads.get(k)||[]),r]);}
  const headText=run=>(heads.get(JSON.stringify([run.secIdx,run.parentParaIdx,run.cellPath]))||[run]).filter(r=>r.charStart<12).sort((a,b)=>a.charStart-b.charStart).reduce((t,r)=>r.charStart===t.length?t+r.text:t,'');
  for(const run of runs){
    if(!run.cellPath?.length||run.charStart!==0)continue;
    const bogi=run.cellPath.at(-1).cellIndex===5&&boxes.has(tableKey(run));
    // 상자 안 항목 줄(○ · (가) · ①)도 — 〈보기〉 밖 「ㄱ.」은 그대로 — handoff가 항목마다 문단을 나눠 넣는다(10-24).
    // 빈 줄은 「ㄱ.」 뒤 칸이 줄바꿈 없는 공백(nbsp)으로 온다 — 그 경우도 찾아야 새 문항부터 내어쓰기가 걸린다.
    const prefix=headText(run).match(bogi?/^[ㄱ-ㅎ]\.[ \u00a0]/:/^(?:[①-⑤○◦•▪◆□■]|\([가-힣]\))[ \u00a0]/)?.[0];if(!prefix)continue;
    const path=JSON.stringify(run.cellPath),start=JSON.parse(document.getCursorRectByPath(run.secIdx,run.parentParaIdx,path,0)),end=JSON.parse(document.getCursorRectByPath(run.secIdx,run.parentParaIdx,path,prefix.length));
    indents.set(paraKey(run.secIdx,run.parentParaIdx,run.cellPath),-Math.round((end.x-start.x)*75));
    // 번호 뒤 보통 띄어쓰기는 고정 띄어쓰기로(10-24 지적 9) — 폭은 같고, 번호와 글이 떨어지지 않으며 조판 부호(빨간 V)가 보인다.
    if(prefix.endsWith(' ')){const at=prefix.length-1;document.deleteTextInCellByPath(run.secIdx,run.parentParaIdx,path,at,1);document.insertTextInCellByPath(run.secIdx,run.parentParaIdx,path,at,'\u00a0');}
  }
  const bytes=CFB?exportLayoutHwpx(document,CFB):document.exportHwpx();
  const zip=await JSZip.loadAsync(new Uint8Array(bytes));
  let header=await zip.file('Contents/header.xml').async('string'),xml=await zip.file('Contents/section0.xml').async('string');
  const styles=new Map([...header.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"[\s\S]*?<\/hh:paraPr>/g)].map(m=>[m[1],m[0]]));
  let nextId=Math.max(...[...styles.keys()].map(Number))+1;
  const clones=new Map(),tags=new Map(),ranges=[],lists=[{next:0,path:[]}],paras=[],tables=[];
  // Walk native paragraph/cell addresses rather than matching their text.
  // Identical statements in another table must retain their own formatting.
  for(const token of xml.matchAll(/<\/?hp:(p|tbl|tc|pic|equation)\b[^>]*>/g)){
    const [tag,kind]=token,closing=tag.startsWith('</');
    if(kind==='p'){
      if(closing){const para=paras.pop();if(!para.path.length&&para.table){const lastRun=xml.lastIndexOf('</hp:run>',token.index),tail=xml.slice(lastRun+9,token.index),line=tail.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/);if(line){const start=lastRun+9+line.index;ranges.push({start,end:start+line[0].length,text:''});}}continue;}
      const list=lists.at(-1),index=list.next++,path=list.path.map(v=>({...v}));if(path.length)path.at(-1).cellParaIndex=index;
      const para={index,path,parent:path.length?list.parent:index,controls:0};paras.push(para);
      const indent=indents.get(paraKey(0,para.parent,path));if(indent===undefined)continue;
      const old=tag.match(/paraPrIDRef="(\d+)"/)?.[1],key=JSON.stringify([old,indent]);if(!styles.has(old))throw Error('보기의 문단 서식을 찾지 못했습니다.');
      if(!clones.has(key)){
        const id=String(nextId++);clones.set(key,id);
        const style=styles.get(old).replace(/\bid="\d+"/,`id="${id}"`).replace(/<hc:intent\b[^>]*>/g,t=>t.replace(/value="-?\d+"/,`value="${t.includes('unit="CHAR"')?Math.floor(indent/2):indent}"`));
        header=header.replace('</hh:paraProperties>',style+'</hh:paraProperties>');
      }
      tags.set(token.index,tag.replace(/paraPrIDRef="\d+"/,`paraPrIDRef="${clones.get(key)}"`));indents.delete(paraKey(0,para.parent,path));
    }else if(kind==='tbl'){
      if(closing)tables.pop();else{paras.at(-1).table=true;tables.push({para:paras.at(-1),control:paras.at(-1).controls++,nextCell:0});}
    }else if(kind==='tc'){
      if(closing)lists.pop();else{const table=tables.at(-1);lists.push({next:0,parent:table.para.parent,path:[...table.para.path,{controlIndex:table.control,cellIndex:table.nextCell++,cellParaIndex:0}]});}
    }else if(!closing)paras.at(-1).controls++;
  }
  if(indents.size)throw Error('보기의 줄 맞춤 위치를 모두 찾지 못했습니다.');
  for(const [start,text] of tags){const end=xml.indexOf('>',start)+1;ranges.push({start,end,text});}
  // Imported table-anchor line positions still include the former equation
  // marker lengths. Drop only root anchor segments, keeping all cell and
  // equation geometry, so the native engine places tables in the current flow.
  for(const edit of ranges.sort((a,b)=>b.start-a.start))xml=xml.slice(0,edit.start)+edit.text+xml.slice(edit.end);
  header=header.replace(/(<hh:paraProperties\b[^>]*itemCnt=")\d+"/,`$1${styles.size+clones.size}"`);
  zip.file('Contents/header.xml',header);zip.file('Contents/section0.xml',xml);
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

// 한글 엔진은 아래·위 첨자 묶음 바로 뒤의 글자까지 첨자로 읽는다(T_{1}=\frac… 가 T 아래에 모두 붙음).
// 닫는 괄호 뒤에 띄어쓰기를 하나 둔다. LaTeX·한글 수식 모두 띄어쓰기는 구분 기호일 뿐 모양을 바꾸지 않는다.
// 앞 첨자(질량수 {}^{b}X, 핵 기호 {}^{A}_{Z}X): rhwp는 빈 밑글자 {}의 위 첨자를 기준선 아래로 그린다(10-25 c1_2026_09_11 「ᵇX」가 아래 첨자처럼 보임).
// 밑글자를 1/4칸 띄어쓰기({`})로 두면 rhwp·한글 모두 위 첨자로 올라간다.
export function normalizeEquationScript(script){
  // \text{…} 안 띄어쓰기는 rhwp가 지워 「피리미딘계열염기의개수」로 붙었다(10-25 b2_2025_09_13) — 수식 띄어쓰기(~)로 바꾼다.
  const s=String(script).replace(/(^|[^\\A-Za-z0-9}])\{\s*\}(?=[_^]\{)/g,'$1{`}')
    .replace(/\\text\{([^{}]*)\}/g,(m,body)=>`\\text{${body.trim().replace(/\s+/g,'~')}}`);let out='';
  for(let i=0;i<s.length;i++){
    out+=s[i];
    if((s[i]==='_'||s[i]==='^')&&s[i+1]==='{'){
      let depth=0,j=i+1;for(;j<s.length;j++){if(s[j]==='\\'){j++;continue;}if(s[j]==='{')depth++;else if(s[j]==='}'&&--depth===0)break;}
      if(j>=s.length)continue;
      out+=s.slice(i+1,j+1);i=j;
      const next=s[j+1];if(next!==undefined&&!/[\s}_^]/.test(next))out+=' ';
    }
  }
  return out;
}
// The native engine accepts both LaTeX and Hancom equation scripts. Generate
// each equation with that engine, then place its native HWPX control in the
// original paragraph/cell. Equations never become bitmap pictures.
export async function materializeEquations(Document,JSZip,bytes,equations,CFB=globalThis.XLSX?.CFB){
  if(!equations.length)return bytes;
  const zip=await JSZip.loadAsync(new Uint8Array(bytes));let xml=await zip.file('Contents/section0.xml').async('string');
  for(const [i,eq] of equations.entries()){
    if(eq.script.length>8000)throw Error('수식은 8,000자 이내로 입력하세요.');
    const temp=Document.createEmpty();let control;
    try{temp.createBlankDocument();const result=JSON.parse(temp.insertEquation(0,0,0,normalizeEquationScript(eq.script),eq.fontSize||1100,0));if(!result.ok)throw Error('수식을 읽지 못했습니다.');const ez=await JSZip.loadAsync(new Uint8Array(temp.exportHwpx())),exml=await ez.file('Contents/section0.xml').async('string');control=exml.match(/<hp:equation\b[\s\S]*?<\/hp:equation>/)?.[0];}finally{temp.free();}
    if(!control)throw Error('한글 수식 개체를 만들지 못했습니다.');
    control=control.replace(/\bid="\d+"/,`id="${1300000000+i}"`);
    if(!xml.includes(eq.marker))throw Error('수식의 원래 입력 위치를 찾지 못했습니다.');
    // Markers contain only ASCII and cannot be fragmented by XML escaping.
    xml=xml.replace(eq.marker,`</hp:t>${control}<hp:t>`);
  }
  zip.file('Contents/section0.xml',xml);
  const native=new Document(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  try{
    // Replacing a long text marker with a native equation invalidates the
    // imported line offsets, widths and heights. Reflow with the equation's
    // real geometry before showing or saving the first preview.
    native.reflowLinesegs();return exportLayoutHwpx(native,CFB);
  }finally{native.free();}
}

// 표 칸(보기 상자·선지·표·상자) 문단: 한글 엔진은 칸 안 줄 높이에 수식 높이를 넣지 않아 분수가 아랫줄과 겹치고,
// 줄바꿈이 있어도 들여온 줄 배치가 한 줄뿐이면 칸 높이를 한 줄로 잡아 글이 칸 밖으로 넘친다.
// 칸 안 글은 조판할 때 어절 단위로 직접 나눠 두었으므로(줄바꿈), 줄마다 가장 큰 수식 높이로 줄 배치를 써 준다.
// 글자 위치: 글자 1, 줄바꿈 1, 수식·탭 같은 조판 부호 8(한글 문서 규칙).
export function cellEquationLines(xml){
  const paragraphs=[],stack=[];
  for(const m of xml.matchAll(/<hp:p\b[^>]*>|<\/hp:p>/g)){
    if(m[0].startsWith('</')){const p=stack.pop();if(p)p.end=m.index;}
    else{const p={body:m.index+m[0].length,depth:stack.length};paragraphs.push(p);stack.push(p);}
  }
  const num=(tag,key)=>Number(tag.match(new RegExp(`\\b${key}="(-?\\d+)"`))?.[1]);
  let output=xml;
  for(let i=paragraphs.length-1;i>=0;i--){
    const p=paragraphs[i];if(!p.depth||p.end===undefined)continue;
    const body=xml.slice(p.body,p.end);
    if(!body.includes('<hp:equation')&&!body.includes('<hp:lineBreak')||body.includes('<hp:p ')||body.includes('<hp:tbl'))continue;
    const first=body.match(/<hp:lineseg\b[^>]*>/)?.[0];if(!first)continue;
    const base={vertpos:num(first,'vertpos'),vertsize:num(first,'vertsize'),baseline:num(first,'baseline'),spacing:num(first,'spacing'),horzpos:num(first,'horzpos'),horzsize:num(first,'horzsize'),flags:num(first,'flags')};
    if(Object.values(base).some(v=>!Number.isFinite(v))||base.vertsize<=0)continue;
    const content=body.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g,'');
    const lines=[{start:0,tall:0}];let pos=0;
    for(const t of content.matchAll(/<hp:equation\b[\s\S]*?<\/hp:equation>|<hp:lineBreak\/>|<hp:(?:tab|pic|ctrl)\b[^>]*?(?:\/>|>[\s\S]*?<\/hp:(?:tab|pic|ctrl)>)|(?<=>)([^<]+)(?=<)/g)){
      if(t[0].startsWith('<hp:equation')){pos+=8;lines.at(-1).tall=Math.max(lines.at(-1).tall,num(t[0].match(/<hp:sz\b[^>]*>/)?.[0]||'','height')||0);}
      else if(t[0]==='<hp:lineBreak/>'){pos+=1;lines.push({start:pos,tall:0});}
      else if(/^<hp:(tab|pic|ctrl)\b/.test(t[0]))pos+=8;
      else if(t[1]!==undefined)pos+=t[1].replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi,'x').length;
    }
    // 줄 배치가 이미 줄마다 있으면(엔진이 계산) 두고, 높은 수식도 줄바꿈도 없으면 그대로 둔다.
    const segCount=(body.match(/<hp:lineseg\b/g)||[]).length;
    if(!lines.some(l=>l.tall>base.vertsize)&&(lines.length<2||segCount>=lines.length))continue;
    let vert=base.vertpos;
    const segs=lines.map(l=>{const h=Math.max(base.vertsize,l.tall),baseline=Math.round(h*base.baseline/base.vertsize);
      const seg=`<hp:lineseg textpos="${l.start}" vertpos="${vert}" vertsize="${h}" textheight="${h}" baseline="${baseline}" spacing="${base.spacing}" horzpos="${base.horzpos}" horzsize="${base.horzsize}" flags="${base.flags}"/>`;vert+=h+base.spacing;return seg;}).join('');
    output=output.slice(0,p.body)+content+`<hp:linesegarray>${segs}</hp:linesegarray>`+output.slice(p.end);
  }
  return output;
}
export async function applyCellEquationLines(bytes,JSZip){
  const zip=await JSZip.loadAsync(new Uint8Array(bytes)),file=zip.file('Contents/section0.xml'),xml=await file.async('string'),next=cellEquationLines(xml);
  if(next===xml)return bytes;
  zip.file('Contents/section0.xml',next);return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

// 어울림: 글 문단 맨 앞에 넣은 그림을 떠 있는 그림(문단 기준 오른쪽·왼쪽, 본문이 옆·아래로 흐름)으로 바꾼다.
// 어느 그림인지는 그림 내용(바이트)으로 찾는다. 표 칸 안 그림은 대상이 아니다. 줄 배치는 부르는 쪽에서 다시 계산한다.
export function applyFloatingPictures(document,floats){
  if(!floats?.length)return;
  const want=floats.map(f=>({align:f.align==='Left'?'Left':'Right',bytes:Uint8Array.from(atob(String(f.data).split(',')[1]||''),c=>c.charCodeAt(0)),done:false}));
  const seen=new Set();
  for(let page=0;page<document.pageCount();page++)for(const c of JSON.parse(document.getPageControlLayout(page)).controls||[]){
    if(c.type!=='image'||c.cellPath?.length)continue;
    const key=`${c.secIdx}:${c.paraIdx}:${c.controlIdx}`;if(seen.has(key))continue;seen.add(key);
    const data=document.getControlImageData(c.secIdx,c.paraIdx,'[]',c.controlIdx),f=want.find(f=>!f.done&&f.bytes.length===data.length&&f.bytes.every((b,i)=>b===data[i]));
    if(!f)continue;f.done=true;
    const result=JSON.parse(document.setPictureProperties(c.secIdx,c.paraIdx,c.controlIdx,JSON.stringify({treatAsChar:false,textWrap:'Square',horzRelTo:'Para',horzAlign:f.align,vertRelTo:'Para',vertAlign:'Top',vertOffset:0,horzOffset:0,outerMarginLeft:f.align==='Right'?250:0,outerMarginRight:f.align==='Left'?250:0})));
    if(result?.ok===false)throw Error('어울림 그림을 배치하지 못했습니다.');
  }
  if(want.some(f=>!f.done))throw Error('어울림 그림을 문단에서 찾지 못했습니다.');
}
// 상자 칸 안 어울림 그림(10-25): 칸 첫 문단 맨 앞에 든 그림을 글 앞 그림으로 바꿔 문단 오른쪽 위(머리 한 줄 아래)에 둔다.
// 칸 안 글은 조판(handoff)이 그림 높이만큼 좁게 나눠 두었으므로 엔진 어울림(Square)을 쓰지 않는다 — 칸 안 글을 엔진이 다시 나누지 않는다.
export function applyCellFloatingPictures(document,floats){
  if(!floats?.length)return;
  const want=floats.map(f=>({align:f.align==='Left'?'Left':'Right',anchorPara:Number(f.anchorPara)||0,line:Number(f.line)||0,bytes:Uint8Array.from(atob(String(f.data).split(',')[1]||''),c=>c.charCodeAt(0)),done:false}));
  const seen=new Set();
  for(let page=0;page<document.pageCount();page++)for(const c of JSON.parse(document.getPageControlLayout(page)).controls||[]){
    if(c.type!=='image'||!c.cellPath?.length)continue;
    const path=JSON.stringify(c.cellPath),key=`${c.secIdx}:${c.paraIdx}:${path}:${c.controlIdx}`;if(seen.has(key))continue;seen.add(key);
    const data=document.getControlImageData(c.secIdx,c.paraIdx,path,c.controlIdx),f=want.find(f=>!f.done&&f.bytes.length===data.length&&f.bytes.every((b,i)=>b===data[i]));
    if(!f)continue;f.done=true;
    // 기준 줄: 같은 칸의 anchorPara번째 문단 첫 줄 위(쪽 좌표 px). 쪽 위 여백까지 포함한 종이 기준으로 넣는다.
    // 기준 줄: 같은 칸의 anchorPara번째 문단 첫 줄 위와 그림 문단 위의 차이(px). 줄 정보의 paraIdx는 칸 안 문단 번호라 칸 경로로만 고른다.
    const cp=x=>x.cellPath.at(-1),ci=x=>[x.controlIndex??x.controlIdx,x.cellIndex??x.cellIdx].join(':'),pi=x=>x.cellParaIndex??x.cellParaIdx;
    const runs=JSON.parse(document.getPageTextLayout(page)).runs.filter(r=>r.secIdx===c.secIdx&&r.cellPath?.length===c.cellPath.length&&ci(cp(r))===ci(cp(c)));
    const own=runs.filter(r=>pi(cp(r))===pi(cp(c))),top=own.length?Math.min(...own.map(r=>r.y)):null;
    // anchorPara 문단부터의 줄(같은 높이 = 한 줄) 가운데 line번째 줄 위에 맞춘다(원본에서 그림 위에 있던 글 줄 수).
    const ys=top===null?[]:[...new Set(runs.filter(r=>pi(cp(r))>=f.anchorPara&&r.y>=top).map(r=>Math.round(r.y)))].sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>4);
    const y=ys.length?Math.max(0,ys[Math.min(f.line,ys.length-1)]-top):null;
    const result=JSON.parse(document.setCellPicturePropertiesByPath(c.secIdx,c.paraIdx,path,c.controlIdx,JSON.stringify({treatAsChar:false,textWrap:'InFrontOfText',horzRelTo:'Para',horzAlign:f.align,horzOffset:0,vertRelTo:'Para',vertAlign:'Top',vertOffset:Math.round((y??0)*75),outerMarginLeft:0,outerMarginRight:0,outerMarginTop:0,outerMarginBottom:0})));
    if(result?.ok===false)throw Error('상자 안 어울림 그림을 배치하지 못했습니다.');
  }
  if(want.some(f=>!f.done))throw Error('상자 안 어울림 그림을 찾지 못했습니다.');
  document.reflowLinesegs?.();
}
// 글줄 속 네모 칸(10-25): 변환기가 표시 글자(U+200B … U+200C)로 감싼 범위에 글자 테두리를 걸고 표시 글자를 지운다.
// HTML 붙여넣기는 글자 테두리를 옮기지 못해 들여온 뒤 엔진 문서에서 건다. 본문 문단과 표 칸 문단 모두.
export function applyInlineBoxes(document,section=0){
  const J=JSON.stringify,border={type:1,width:1,color:'#000000'},props=J({borderLeft:border,borderRight:border,borderTop:border,borderBottom:border});
  let count=0;
  for(const r of nativeRuns(document,section)){
    // 상자 밖 빈 폭 표시 글자(들여 쓴 식 줄 앞·식 사이 넓은 틈)는 테두리 없이 전각 빈칸으로.
    if(r.text.includes('\uE1B2')){
      const inBox=new Set();for(let i=0;i<r.text.length;i++)if(r.text[i]==='\u200B'){const j=r.text.indexOf('\u200C',i+1);if(j<0)break;for(let k=i;k<=j;k++)inBox.add(k);i=j;}
      for(let i=r.text.length-1;i>=0;i--){if(r.text[i]!=='\uE1B2'||inBox.has(i))continue;
        if(r.path){const path=J(r.path);document.deleteTextInCellByPath(section,r.parent,path,i,1);document.insertTextInCellByPath(section,r.parent,path,i,'\u3000');}
        else{document.deleteText(section,r.para,i,1);document.insertText(section,r.para,i,'\u3000');}
        r.text=r.text.slice(0,i)+'\u3000'+r.text.slice(i+1);count++;}
    }
    if(!r.text.includes('\u200B'))continue;
    const pairs=[];for(let i=0;i<r.text.length;i++){if(r.text[i]==='\u200B'){const j=r.text.indexOf('\u200C',i+1);if(j<0)break;pairs.push([i,j]);i=j;}}
    for(const [a,b] of pairs.reverse()){
      // 빈 폭 표시 글자(U+E1B2)는 전각 빈칸으로 바꾼다(변환기가 원본 상자 폭만큼 적어 둠).
      const pads=[];for(let i=b-1;i>a;i--)if(r.text[i]==='\uE1B2')pads.push(i);
      if(r.path){const path=J(r.path);document.deleteTextInCellByPath(section,r.parent,path,b,1);
        for(const i of pads){document.deleteTextInCellByPath(section,r.parent,path,i,1);document.insertTextInCellByPath(section,r.parent,path,i,'\u3000');}
        document.deleteTextInCellByPath(section,r.parent,path,a,1);
        if(b-1>a)document.applyCharFormatInCellByPath(section,r.parent,path,a,b-1,props);}
      else{document.deleteText(section,r.para,b,1);for(const i of pads){document.deleteText(section,r.para,i,1);document.insertText(section,r.para,i,'\u3000');}
        document.deleteText(section,r.para,a,1);if(b-1>a)document.applyCharFormat(section,r.para,a,b-1,props);}
      count++;
    }
  }
  if(count)document.reflowLinesegs();
  return count;
}
// 선지가 글 옆 그림 옆에 들어가면 그림 옆에 둔다(10-25). 평가원 지면은 키 큰 글 옆 그림 옆에 선지까지 놓는데(p2_2024_06_07 회로),
// 선지 표(테두리 없는 칸)는 마지막 칸이 단 끝까지 늘어나 그림과 겹쳐 settleFloatingPictures가 그림 아래로 밀었다(높이 1.7배).
// 마지막 칸을 글 폭만큼 줄여 표 오른쪽 끝이 그림 왼쪽 안에 들어가면 줄인다. settleFloatingPictures 전에 부른다. 오른쪽 그림만.
export function shrinkChoicesBeside(document,section=0){
  const J=JSON.parse,GAP=8;let count=0;
  for(let page=0;page<document.pageCount();page++){
    const controls=(J(document.getPageControlLayout(page)).controls||[]).filter(c=>!c.cellPath?.length&&c.secIdx===section);
    const floats=controls.filter(c=>c.type==='image').filter(c=>{try{const p=J(document.getPictureProperties(c.secIdx,c.paraIdx,c.controlIdx));return !p.treatAsChar&&p.horzAlign!=='Left';}catch{return false;}});
    if(!floats.length)continue;
    const runs=J(document.getPageTextLayout(page)).runs,inner=J(document.getPageControlLayout(page)).controls||[];
    for(const t of controls.filter(c=>c.type==='table')){
      const f=floats.find(f=>t.paraIdx>f.paraIdx&&t.y<f.y+f.h&&t.x+t.w>f.x-GAP);if(!f)continue;
      let props,boxes;try{props=J(document.getTableProperties(t.secIdx,t.paraIdx,t.controlIdx));boxes=J(document.getTableCellBboxes(t.secIdx,t.paraIdx,t.controlIdx));}catch{continue;}
      if(!props.treatAsChar)continue;
      const cell0=J(document.getCellProperties(t.secIdx,t.paraIdx,t.controlIdx,0));if(cell0.borderLeft?.type!==0||cell0.borderTop?.type!==0)continue;
      // 선지 표만: 맨 마지막 맨 바깥 표이고 칸 글이 ①로 시작하는 것(〈보기〉 상자도 테두리 없는 바깥 칸이라 줄어들었다, e1_2025_06_08).
      if(t!==controls.filter(c=>c.type==='table').at(-1)||!runs.some(r=>r.cellPath?.length&&(r.parentParaIdx??r.paraIdx)===t.paraIdx&&/^①/.test(String(r.text).trim())))continue;
      const cols=Math.max(...boxes.map(b=>b.col+(b.colSpan||1)));const last=boxes.filter(b=>b.col===cols-1&&(b.colSpan||1)===1);if(!last.length)continue;
      const inCell=(x,b)=>x.x>=b.x-1&&x.x<b.x+b.w&&x.y>=b.y-1&&x.y<b.y+b.h;
      const need=Math.max(...last.map(b=>{const r=[...runs.filter(x=>x.cellPath?.length&&String(x.text||'').trim()&&inCell(x,b)),...inner.filter(x=>x.type==='equation'&&inCell(x,b))]/* 칸 안 수식도 칸 경로 없이 보고된다 */.map(x=>x.x+x.w);return r.length?Math.max(...r)-b.x+6:0;}));
      const lastX=Math.min(...last.map(b=>b.x)),lastW=Math.max(...last.map(b=>b.w)),newRight=lastX+need;
      if(!(need>0)||newRight>f.x-GAP||need>=lastW-2)continue;
      const delta=-Math.floor((lastW-need)*75);
      const r=J(document.resizeTableCells(t.secIdx,t.paraIdx,t.controlIdx,JSON.stringify(last.map(b=>({cellIdx:b.cellIdx,widthDelta:delta})))));
      // 줄인 표가 문단 가운데로 옮겨가 그림에 가리지 않게 왼쪽 정렬로.
      if(r?.ok!==false){document.applyParaFormat(t.secIdx,t.paraIdx,JSON.stringify({alignment:'left'}));count++;}
    }
  }
  if(count)document.reflowLinesegs();
  return count;
}
// 글 옆 그림·표(떠 있는 개체) 옆 좁은 줄은 왼쪽 정렬로(10-25). 양쪽 정렬이면 수식(단위)·긴 낱말이 든 좁은 줄의 띄어쓰기가 크게 벌어졌다
// (p2_2024_06_03 「질량은   0.1 kg이고,   열의」). 자간 맞춤은 수식·개체가 든 문단을 건너뛰어 이 줄을 못 고친다. 개체 옆에 줄이 있는 맨 바깥 문단만.
export function alignBesideLeft(document,section=0){
  const J=JSON.parse;let count=0;
  for(let page=0;page<document.pageCount();page++){
    const floats=(J(document.getPageControlLayout(page)).controls||[]).filter(c=>['image','table'].includes(c.type)&&!c.cellPath?.length&&c.secIdx===section).filter(c=>{
      try{return !J(c.type==='image'?document.getPictureProperties(c.secIdx,c.paraIdx,c.controlIdx):document.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx)).treatAsChar;}catch{return false;}});
    if(!floats.length)continue;
    const paras=new Set();
    for(const r of J(document.getPageTextLayout(page)).runs){if(r.cellPath?.length||r.secIdx!==section||!r.text.trim())continue;
      if(floats.some(f=>r.y<f.y+f.h&&r.y+r.h>f.y&&(r.x+r.w<=f.x+1||r.x>=f.x+f.w-1)))paras.add(r.paraIdx);}
    for(const para of paras){const props=J(document.getParaPropertiesAt(section,para));if(String(props.alignment).toLowerCase()!=='justify')continue;
      document.applyParaFormat(section,para,JSON.stringify({alignment:'left'}));count++;}
  }
  if(count)document.reflowLinesegs();
  return count;
}
// 칸 높이를 글에 맞춰 늘린다(10-25). 들여온 뒤 문단 모양(줄 간격 145% 등)을 바꾸면 칸 높이(cellSz)는 들여올 때 값 그대로라
// 마지막 줄이 칸 아래 테두리에 잘렸다(b1_2026_06_09 상자 「… 결론을 내렸다.」). 맨 바깥 표 칸만 보고, 줄지는 않는다.
export function growCellsToContent(document,section=0){
  const J=JSON.parse;let grown=0;
  const ci=x=>[x.controlIndex??x.controlIdx,x.cellIndex??x.cellIdx];
  for(let page=0;page<document.pageCount();page++){
    const tables=(J(document.getPageControlLayout(page)).controls||[]).filter(c=>c.type==='table'&&!c.cellPath?.length&&c.secIdx===section);
    if(!tables.length)continue;
    const runs=J(document.getPageTextLayout(page)).runs.filter(r=>r.cellPath?.length&&r.secIdx===section);
    const inner=(J(document.getPageControlLayout(page)).controls||[]).filter(c=>c.cellPath?.length&&c.secIdx===section&&Number.isFinite(c.y)&&Number.isFinite(c.h));
    for(const t of tables){
      let boxes;try{boxes=J(document.getTableCellBboxes(t.secIdx,t.paraIdx,t.controlIdx));}catch{continue;}
      for(const b of boxes.filter(b=>b.pageIndex===page)){
        // 칸 안 조각의 paraIdx는 칸 문단 번호 — 바깥 문단은 parentParaIdx다.
        const mine=x=>(x.parentParaIdx??x.paraIdx)===t.paraIdx&&(()=>{const [ctrl,cell]=ci(x.cellPath[0]);return ctrl===t.controlIdx&&cell===b.cellIdx;})();
        // 칸 상자 안에서 시작하는 조각만(같은 문단의 다른 표·상자 조각이 섞여 들어와 칸을 수백 px 늘렸다). 150px 넘게는 늘리지 않는다.
        const inside=x=>x.x>=b.x-1&&x.x<b.x+b.w&&x.y>=b.y-1&&x.y<b.y+b.h;
        const bottom=Math.max(...runs.filter(r=>mine(r)&&inside(r)).map(r=>r.y+r.h),...inner.filter(c=>mine(c)&&inside(c)).map(c=>c.y+c.h),-Infinity);
        if(!Number.isFinite(bottom))continue;
        let props;try{props=J(document.getCellProperties(t.secIdx,t.paraIdx,t.controlIdx,b.cellIdx));}catch{continue;}// 칸 상자(getTableCellBboxes)가 실제 그린 표보다 아래로 잡힐 때가 있다(c2_2024_06_10: 칸 542px, 표 525px) — 마지막 줄 칸은 표 아래 끝과도 견준다.
        const lastRow=b.y+b.h>=Math.max(...boxes.map(x=>x.y+x.h))-1,cellBottom=lastRow?Math.min(b.y+b.h,t.y+t.h):b.y+b.h;const need=bottom+props.paddingBottom/75-cellBottom;
        // 저장한 칸 높이(props.height)도 본다 — 엔진은 그릴 때 칸을 글만큼 늘려 보여 주지만 저장값은 그대로라, 다시 열면 칸이 줄어 마지막 줄(분수)이 테두리에 잘렸다(c2_2024_06_10 〈보기〉 ㄷ). 높은 글 칸(30px 이상)만 — 〈보기〉 제목 칸은 일부러 작게 둔다.
        const stored=b.h>=30?Math.ceil((bottom-b.y)*75+props.paddingBottom)-props.height:0;
        const grow=Math.max(need>0.5?Math.ceil(need*75):0,stored>37?stored:0);
        if(!grow||grow>150*75)continue;
        const r=J(document.setCellProperties(t.secIdx,t.paraIdx,t.controlIdx,b.cellIdx,JSON.stringify({height:Math.max(props.height+grow,Math.ceil(b.h*75)+(need>0.5?Math.ceil(need*75):0))})/* 그린 높이보다 작게 두면 칸이 그 높이로 묶여 잘렸다(b2_2024_09_14) */));
        if(r?.ok!==false)grown++;
      }
    }
  }
  if(grown)document.reflowLinesegs();
  return grown;
}
// 어울림 그림을 놓은 뒤의 줄 배치 점검. 한글 엔진은 그림 높이 안에 든 두 줄짜리 문단을 그림 반대쪽으로 밀어 잘못 흐르게 한다.
// 그림이 붙은 문단이 그림과 겹치거나 그림보다 짧으면(다음 문단도 그림 옆에 와야 함) 엔진의 어울림 대신
// 그림은 글 앞(단 기준 정렬)에 두고, 그림 옆에서 시작하는 문단마다 오른쪽(왼쪽) 여백을 그림 폭만큼 둔다(평가원처럼 발문도 그림 옆).
// 표·그림 문단이 그림 옆에서 시작하면 앞 문단 아래 간격을 둬서 그림 밑으로 보낸다. 문단 모양 단위: 여백·간격은 px×150.
export function settleFloatingPictures(document){
  const GAP=4,pics=[];
  for(let page=0;page<document.pageCount();page++)for(const c of JSON.parse(document.getPageControlLayout(page)).controls||[]){
    if(!['image','table'].includes(c.type)||c.cellPath?.length)continue;
    // 쪽 배치가 표로 알려 주는 개체 중 엔진이 표로 읽지 못하는 것(〈보기〉 상자 속 표 등)은 건너뛴다(기출 탐색기: b1_2013_06_08).
    let props;try{props=JSON.parse(c.type==='image'?document.getPictureProperties(c.secIdx,c.paraIdx,c.controlIdx):document.getTableProperties(c.secIdx,c.paraIdx,c.controlIdx));}catch{continue;}if(props.treatAsChar)continue;
    if(pics.some(p=>p.type===c.type&&p.para===c.paraIdx&&p.ci===c.controlIdx))continue;
    pics.push({page,type:c.type,sec:c.secIdx,para:c.paraIdx,ci:c.controlIdx,props});
  }
  if(!pics.length)return false;
  const box=p=>(JSON.parse(document.getPageControlLayout(p.page)).controls||[]).find(c=>c.type===p.type&&c.secIdx===p.sec&&c.paraIdx===p.para&&c.controlIdx===p.ci);
  const setProps=(p,v)=>p.type==='image'?document.setPictureProperties(p.sec,p.para,p.ci,JSON.stringify(v)):document.setTableProperties(p.sec,p.para,p.ci,JSON.stringify(v));
  const lines=(p,para)=>{const m=new Map();for(const r of JSON.parse(document.getPageTextLayout(p.page)).runs){if(r.cellPath?.length||r.secIdx!==p.sec||r.paraIdx!==para||!r.text.trim())continue;const k=Math.round(r.y*10),v=m.get(k)||{y:r.y,h:0,x0:Infinity,x1:-Infinity};v.h=Math.max(v.h,r.h);v.x0=Math.min(v.x0,r.x);v.x1=Math.max(v.x1,r.x+r.w);m.set(k,v);}return [...m.values()];};
  const controlParas=p=>new Set((JSON.parse(document.getPageControlLayout(p.page)).controls||[]).filter(c=>!c.cellPath?.length&&c.secIdx===p.sec&&(c.type==='table'||c.type==='image')).map(c=>c.paraIdx));
  const bottomOf=ls=>ls.length?Math.max(...ls.map(l=>l.y+l.h)):-Infinity;
  const space=(p,para,needed)=>{const props=JSON.parse(document.getParaPropertiesAt(p.sec,para));document.applyParaFormat(p.sec,para,JSON.stringify({spacingAfter:Math.round(((props.spacingAfter||0)/2+needed)*150)}));document.reflowLinesegs();};
  let count=document.getParagraphCount?.(pics[0].sec);
  // 한 문단은 한 번만 좁힌다 — 자료 표와 그 아래 범례 표를 함께 띄우면(10-25) 두 개체가 같은 문단을 두 번 좁혔다.
  const narrowed=new Set();
  for(const p of pics){
    const right=p.props.horzAlign!=='Left';let b=box(p);if(!b)continue;
    const own=lines(p,p.para),overlaps=own.some(l=>l.y<b.y+b.h&&l.y+l.h>b.y&&(right?l.x1>b.x+1:l.x0<b.x+b.w-1));
    if(!overlaps&&bottomOf(own)+GAP>=b.y+b.h)continue;
    const room=b.w+((right?p.props.outerMarginLeft:p.props.outerMarginRight)||0)/75+GAP+2;
    const narrow=para=>{if(narrowed.has(para))return;narrowed.add(para);const props=JSON.parse(document.getParaPropertiesAt(p.sec,para));document.applyParaFormat(p.sec,para,JSON.stringify(right?{marginRight:Math.round(((props.marginRight||0)+room)*150)}:{marginLeft:Math.round(((props.marginLeft||0)+room)*150)}));};
    setProps(p,{textWrap:'InFrontOfText',horzRelTo:'Column'});
    if(own.length)narrow(p.para);document.reflowLinesegs();b=box(p);
    let last=p.para;
    for(let para=p.para+1;Number.isInteger(count)?para<count:para<p.para+20;para++){
      const ls=lines(p,para);
      // 띄운 개체만 든 문단(함께 띄운 범례 표)은 건너뛰고 그 아래 글 문단까지 좁힌다(b1_2026_11_09 표가 글을 덮음).
      if(!ls.length&&pics.some(q=>q!==p&&q.sec===p.sec&&q.para===para))continue;
      if(!ls.length||controlParas(p).has(para))break;
      if(Math.min(...ls.map(l=>l.y))>=b.y+b.h)break;
      // 그림 아래로 네 줄 가까이 넘게 길어지는 문단은 좁히지 않고 그림 밑에서 단 폭으로 시작하게 한다(긴 설명이 좁은 폭으로 길게 늘어지지 않게).
      const before=JSON.parse(document.getParaPropertiesAt(p.sec,para));
      narrow(para);document.reflowLinesegs();b=box(p);
      // 단, 문단이 개체 윗변과 같은 높이에서 시작하면(번호 문단 위에 띄운 글 옆 표) 그림 밑으로 보낼 수 없다 — 좁힌 채 둔다(10-25 b1_2026_11_09 긴 발문이 표 밑에 깔림).
      // 개체 윗변 높이에서 시작한 긴 문단은 개체 아래 첫 줄에서 둘로 나눈다 — 위는 좁힌 채 개체 옆, 아래는 단 폭(원본 어울림처럼).
      // 통째로 좁히면 짧은 표 옆에서 긴 발문 전체가 좁은 줄로 늘어졌다(10-25 b2_2026_11_10).
      if(Math.min(...ls.map(l=>l.y))<=b.y+2&&bottomOf(lines(p,para))>b.y+b.h+90){
        const runsP=JSON.parse(document.getPageTextLayout(p.page)).runs.filter(r=>!r.cellPath?.length&&r.secIdx===p.sec&&r.paraIdx===para&&r.text.trim());
        const below=runsP.filter(r=>r.y>=b.y+b.h).sort((x,y)=>x.y-y.y||x.x-y.x)[0];
        if(below&&Number.isInteger(below.charStart)&&below.charStart>0){
          const res=JSON.parse(document.splitParagraph(p.sec,para,below.charStart,null)||'{}');
          if(res?.ok!==false){
            const hang=Math.max(0,-(before.indent||0));
            document.applyParaFormat(p.sec,para+1,JSON.stringify({marginRight:Math.round((before.marginRight||0)*150),marginLeft:Math.round(((before.marginLeft||0)+hang)*150),indent:0,spacingBefore:0}));
            document.applyParaFormat(p.sec,para,JSON.stringify({spacingAfter:0}));
            if(Number.isInteger(count))count++;for(const q of pics)if(q!==p&&q.sec===p.sec&&q.para>para)q.para++;
            document.reflowLinesegs();b=box(p);last=para;break;
          }
        }
      }
      if(Math.min(...ls.map(l=>l.y))>b.y+2&&bottomOf(lines(p,para))>b.y+b.h+90){document.applyParaFormat(p.sec,para,JSON.stringify(right?{marginRight:Math.round((before.marginRight||0)*150)}:{marginLeft:Math.round((before.marginLeft||0)*150)}));document.reflowLinesegs();b=box(p);break;}
      last=para;
    }
    // 글 없는 문단에 붙은 표: 그 문단 높이만큼 내려 다음 문단 첫 줄과 위를 맞춘다.
    if(!own.length&&last!==p.para){const top=Math.min(...lines(p,p.para+1).map(l=>l.y));if(Number.isFinite(top)&&top>b.y+.5){setProps(p,{vertOffset:Math.round((top-b.y)*75)});document.reflowLinesegs();b=box(p);}}
    const bottom=bottomOf(lines(p,last));
    // 바로 뒤 표(선지 표 등)가 그림 옆에 들어가면(shrinkChoicesBeside로 줄인 것) 그림 아래로 밀지 않는다.
    const nextTable=(JSON.parse(document.getPageControlLayout(p.page)).controls||[]).find(c=>c.type==='table'&&!c.cellPath?.length&&c.secIdx===p.sec&&c.paraIdx===last+1);
    // 표 개체 폭은 칸을 줄여도 옛 값으로 남는다 — 칸 상자로 오른쪽 끝을 잰다.
    let tableRight=nextTable?nextTable.x+nextTable.w:0;if(nextTable)try{tableRight=Math.max(...JSON.parse(document.getTableCellBboxes(nextTable.secIdx,nextTable.paraIdx,nextTable.controlIdx)).map(c=>c.x+c.w));}catch{}
    const fitsBeside=nextTable&&(right?tableRight<=b.x-GAP:nextTable.x>=b.x+b.w+GAP);
    if(!fitsBeside&&b.y+b.h+GAP>bottom)space(p,last,b.y+b.h+GAP-bottom);
  }
  return true;
}

// 글 옆 표: 첫 지문(번호 문단) 바로 앞 문단에 든 표를 떠 있는 표로 바꾼다. 줄 배치는 settleFloatingPictures가 맞춘다.
export function applyFloatingTable(document,spec,number){
  if(!spec)return;
  const prefix=`${number}. `;
  for(let page=0;page<document.pageCount();page++){
    const run=JSON.parse(document.getPageTextLayout(page)).runs.find(r=>!r.cellPath?.length&&(r.text.startsWith(prefix)||r.text===`${number}.`));if(!run)continue;
    // 번호 문단 바로 앞에 이어진 맨 바깥 표 문단들(자료 표, 그 아래 범례 「(단위: kcal)」 표)을 함께 띄운다. 범례가 따로 한 문단이 된 뒤(10-25 표 범례 오른쪽 끝)
    // 바로 앞 문단 하나만 띄우면 범례만 글 옆으로 가고 자료 표는 번호 위에 남았다(b1_2026_06_02). 뒤 표는 앞 표 높이만큼 내려 놓는다.
    const controls=(JSON.parse(document.getPageControlLayout(page)).controls||[]).filter(c=>c.type==='table'&&!c.cellPath?.length);
    const group=[];for(let p=run.paraIdx-1;p>=0;p--){const t=controls.find(c=>c.paraIdx===p);if(!t)break;group.unshift(t);}
    if(!group.length)throw Error('글 옆 표를 찾지 못했습니다.');
    let offset=0;
    for(const t of group){
      const r=JSON.parse(document.setTableProperties(t.secIdx,t.paraIdx,t.controlIdx,JSON.stringify({treatAsChar:false,textWrap:'InFrontOfText',horzRelTo:'Column',horzAlign:spec.align,vertRelTo:'Para',vertAlign:'Top',vertOffset:Math.round(offset*75),horzOffset:0})));
      if(r?.ok===false)throw Error('글 옆 표를 배치하지 못했습니다.');offset+=t.h;
    }
    // 표가 둘 이상이면 띄운 표 문단들이 빈 줄로 남아 번호 줄이 내려간다 — 다시 재서 표 윗변을 번호 줄 윗변에 맞춘다.
    // 표 하나여도: 띄운 표만 든 문단이 본문 한 줄 높이로 남으면 발문이 표 아래에서 시작한 것으로 잡혀 옆 줄을 좁히지 않았다(b1_2024_09_16 표가 발문을 덮음).
    {
      // 띄운 표만 든 문단은 줄 높이를 1pt로(빈 줄로 남지 않게, 시험지 첫 빈 문단과 같은 방법).
      for(const t of group){document.applyParaFormat(t.secIdx,t.paraIdx,JSON.stringify({lineSpacingType:'Percent',lineSpacing:100,spacingBefore:0,spacingAfter:0}));
        const n=document.getParagraphLength(t.secIdx,t.paraIdx);if(n)document.applyCharFormat(t.secIdx,t.paraIdx,0,n,JSON.stringify({fontSize:100}));}
      document.reflowLinesegs();
      const now=JSON.parse(document.getPageTextLayout(page)).runs.find(r=>!r.cellPath?.length&&(r.text.startsWith(prefix)||r.text===`${number}.`));
      const placed=(JSON.parse(document.getPageControlLayout(page)).controls||[]).filter(c=>c.type==='table'&&!c.cellPath?.length&&group.some(g=>g.paraIdx===c.paraIdx));
      const first=placed.find(c=>c.paraIdx===group[0].paraIdx);
      if(now&&first&&Math.abs(now.y-first.y)>1){
        let at=0;
        for(const t of group){const c=placed.find(x=>x.paraIdx===t.paraIdx);if(!c)continue;
          const anchor=c.y-at;document.setTableProperties(c.secIdx,c.paraIdx,c.controlIdx,JSON.stringify({vertOffset:Math.round((now.y-anchor+at)*75)}));at+=t.h;}
      }
    }
    return;
  }
  throw Error('글 옆 표의 지문을 찾지 못했습니다.');
}

// 빈 「ㄱ.」「①」 뒤 한 칸을 고정 띄어쓰기(U+00A0)로(10-22 O5). 조판 기준 parts.labelSpace가 'fixed'일 때만(10-23: 교사가 고름, 수능 틀은 보통 띄어쓰기).
// HTML 붙여넣기는 &nbsp;를 보통 띄어쓰기로 바꿔서, 들여온 뒤 엔진 문서에서 바꾼다. 글이 이미 들어간 칸은 손대지 않는다 — 비어 있는 자리만(교사가 칠 자리).
export function fixedLabelSpaces(document,section=0){
  const J=JSON.stringify;let count=0;
  for(const r of nativeRuns(document,section)){
    if(!r.path||!/^(?:[ㄱ-ㅎ]\.|[①-⑳]) $/.test(r.text))continue;
    const at=r.text.length-1,path=J(r.path);
    document.deleteTextInCellByPath(section,r.parent,path,at,1);document.insertTextInCellByPath(section,r.parent,path,at,'\u00a0');count++;
  }
  return count;
}
