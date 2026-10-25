// 기출 PDF 줄 → 문항 칸 규칙(AI 없음). 변환기(es/)가 읽은 줄 위치·상자 테두리·그림·표 위치만으로 나눈다.
// - 상자: PDF의 네 변(선 4개 또는 사각형)으로 찾는다. 상자 안 줄·그림·표는 상자 칸(조건·실험)으로.
// - 문단: 문항 번호 줄 기준 본문 왼쪽(B)에서 한 글자쯤 들여 쓴 줄이 새 문단. 더 들여 쓴 줄(가운데 수식·그림 이름)은 따로.
// - 발문: 변환기가 '이에 대한…'으로 찾은 줄, 없으면 상자 밖 마지막 '?' 문단(뒤따르는 '(단, …)'·[3점] 포함).
// 좌표: 상자·그림·표는 위가 0인 PDF 좌표, 줄의 y는 아래가 0이라 pageHeight로 뒤집는다.

// 줄 하나의 글. 수식은 $스크립트$. 그림 런은 뺀다.
export const runsText=runs=>(runs||[]).filter(r=>r.kind!=='figure').map(r=>r.kind==='equation'?`$${String(r.script||r.value||'').trim()}$`:String(r.value||'')).join('');
// 수식($…$) 짝으로 읽는다: 빈 수식은 빼고, 사이에 아무것도 없는 두 수식은 하나로, 띄어쓰기만 있으면 수식 안 띄어쓰기(~)로 잇는다.
// 예전 /\$\s*\$/ 지우기는 「$X$ $1mol$」의 띄어쓰기까지 지워 「$X1mol$」로 붙였다(10-25 c1_2026_09_11).
// 바로 선 글자(10-25): 원본은 단위(0.2 m, 210 N, km/s, mol)와 화학식(KCl, H₂O, NaOH, Ca²⁺)을 바로 세워 찍는다. 수식 글꼴이 같아
// PDF로는 기울임을 가릴 수 없어(X와 KCl이 같은 글꼴) 규칙으로 정한다. 변수(3m의 m, 가상 원소 X·Y·A)는 그대로 기울인다.
const ELEMENTS=new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Ag Cd Sn I Xe Cs Ba Pt Au Hg Pb U'.split(' '));
const ION1=new Set(['H','K','O','F','N','S','I']);
const UNIT_MULTI=new Set('kg km cm mm nm μm mL mol Mpc kpc pc cal kcal kJ atm Pa kPa hPa Hz kHz eV MeV min AU ly'.split(' '));
const UNIT_ONE=new Set('m g s N J W V K L M A T C Ω h'.split(' ')),UNIT_SURE=new Set('N J W V Ω'.split(' '));
const rm=v=>`{rm ${v}}`;
// 화학식: 원소 기호(아래 숫자·전하 첨자 포함)만으로 된 덩이. 두 글자 원소·아래 숫자·전하 중 하나가 있어야 한다(PV, BC 같은 변수 곱은 그대로).
function chemAt(s,i){
  if(i>0&&/[A-Za-z\\]/.test(s[i-1]))return null;
  let j=i,parts=[],elems=0;
  while(j<s.length&&/[A-Z]/.test(s[j])){
    let sym=s[j];if(/[a-z]/.test(s[j+1]||'')&&ELEMENTS.has(s[j]+s[j+1])){sym=s[j]+s[j+1];}
    if(!ELEMENTS.has(sym))return null;
    let k=j+sym.length,sub='',sup='';
    const m1=s.slice(k).match(/^_\{(\d+)\}/);if(m1){sub=m1[0];k+=sub.length;}
    const m2=s.slice(k).match(/^\^\{(\d*[+\-])\}/);if(m2){sup=m2[0];k+=sup.length;}
    parts.push({sym,sub,sup});elems++;j=k;
  }
  if(!elems||/[A-Za-z]/.test(s[j]||''))return null;
  // 원소 하나(B₀, N 등)는 두 글자 원소·흔한 이온(H⁺, O²⁻)·분자(H₂, O₂)일 때만 — 물리 변수 B₀·v₀는 그대로.
  // 원소 둘 이상에 상태 기호가 바로 붙으면 화학식이다(CO(g)). 한 글자(B(s), C(g))는 가상 물질 A·B·C일 때가 많아 그대로.
  const state=elems>1&&/^\((?:s|l|g|aq)\b/.test(s.slice(j));
  const strong=state||(elems>1?parts.some(p=>p.sym.length>1||p.sub||p.sup):parts.some(p=>p.sym.length>1||(p.sub&&/^[HNOFISP]$/.test(p.sym))||(p.sup&&ION1.has(p.sym))));
  if(!strong)return null;
  // 첨자 없이 이어진 원소 기호는 한 {rm …}로 묶는다(KCl, NaOH → {rm NaOH}, C₆H₁₂O₆ → {rm C}_{6}{rm H}_{12}…).
  let text='',run='';for(const p of parts){run+=p.sym;if(p.sub||p.sup){text+=rm(run)+p.sub+p.sup;run='';}}if(run)text+=rm(run);
  return {end:j,text};
}
// 단위 식: 단위(·, / 로 이음, 끝 ^{2} 허용). 앞에 수가 있으면 판정이 너그럽다.
function unitAt(s,i,afterNumber){
  const m=s.slice(i).match(/^((?:μ?[A-Za-zΩ]+)(?:\^\{-?\d\})?)((?:[\/·](?:μ?[A-Za-zΩ℃]+)(?:\^\{-?\d\})?)*)/);
  if(!m)return null;const all=m[0],toks=all.split(/[\/·]/).map(t=>t.replace(/\^\{-?\d\}$/,''));
  if(/[A-Za-z]/.test(s[i+all.length]||''))return null;
  if(!toks.every(t=>t==='℃'||UNIT_MULTI.has(t)||UNIT_ONE.has(t)))return null;
  const compound=toks.length>1,multi=toks.some(t=>UNIT_MULTI.has(t));
  if(!(multi||compound||afterNumber==='decimal'||(afterNumber&&UNIT_SURE.has(toks[0]))))return null;
  return {end:i+all.length,text:all.replace(/μ?[A-Za-zΩ]+/g,t=>rm(t))};
}
const ABBR=new Set('LED LCD ATP ADP AMP DNA RNA mRNA tRNA rRNA NAD NADH NADP NADPH FAD FADH TSH ADH ACTH LH FSH GPS CCTV PET CT MRI pH pOH SI'.split(' '));
export function uprightScript(eq){
  // 잘 쓰는 약어(LED, ATP, DNA, TSH …)는 바로 선 글자(10-25 밤, c1_2025_09_04 LED 기울어짐). 점 이름(ABC)은 기울임 그대로라 목록으로만.
  if(ABBR.has(eq))return rm(eq);
  let out='',i=0;
  const whole=unitAt(eq,0,false);if(whole&&whole.end===eq.length&&!/^\{rm/.test(eq))return whole.text;
  while(i<eq.length){
    const c=eq[i];
    if(c==='\\'){const m=eq.slice(i).match(/^\\text\{[^{}]*\}|^\\[A-Za-z]+/);out+=m[0];i+=m[0].length;continue;}
    if(eq.startsWith('{rm',i)){const k=eq.indexOf('}',i);out+=eq.slice(i,k+1);i=k+1;continue;}
    const num=eq.slice(i).match(/^\d+(?:\.\d+)?(?:×10\^\{-?\d+\})?[`~\s]*/);
    if(num&&(i===0||!/[A-Za-z0-9.]/.test(eq[i-1]))){
      const u=unitAt(eq,i+num[0].length,/\.|×10/.test(num[0])?'decimal':'number');
      if(u){out+=num[0]+u.text;i=u.end;continue;}
      out+=num[0];i+=num[0].length;continue;
    }
    {const w=/[A-Za-z]/.test(c)&&!/[A-Za-z\\]/.test(eq[i-1]||'')?eq.slice(i).match(/^[A-Za-z]+/)[0]:'';if(w&&ABBR.has(w)){out+=rm(w);i+=w.length;continue;}}
    if(/[A-Z]/.test(c)){const ch=chemAt(eq,i);if(ch){out+=ch.text;i=ch.end;continue;}}
    out+=c;i++;
  }
  return out;
}
// 수식 밖 글자 바로잡기: 물결 연산자 ∼(U+223C)는 함초롬바탕에서 ∞처럼 그려지고, 한 점 끌기 ․(U+2024)는 아래에 찍힌다 —
// 원본(평가원 지면)은 「A～D」 「시·공간적」(10-25 e2_2024_09_03, b1_2026_09_20).
const TEXT_FIX={'\u223c':'～','\u2024':'·'};
// 원소 이름 바로 뒤 괄호 속 한 글자 기호는 실제 원소다(산소(O), 탄소(C), 수소(H)) — 바로 선 글자로(10-25 밤).
const ELEMENT_NAMES={'수소':'H','헬륨':'He','리튬':'Li','베릴륨':'Be','붕소':'B','탄소':'C','질소':'N','산소':'O','플루오린':'F','네온':'Ne','나트륨':'Na','마그네슘':'Mg','알루미늄':'Al','규소':'Si','인':'P','황':'S','염소':'Cl','아르곤':'Ar','칼륨':'K','칼슘':'Ca','철':'Fe','구리':'Cu','아연':'Zn','은':'Ag','금':'Au','납':'Pb','수은':'Hg'};
export const namedElements=t=>t.replace(/(수소|헬륨|리튬|베릴륨|붕소|탄소|질소|산소|플루오린|네온|나트륨|마그네슘|알루미늄|규소|황|염소|아르곤|칼륨|칼슘|철|구리|아연|수은|납)\(\$([A-Z][a-z]?)\$\)/g,(m,name,sym)=>ELEMENT_NAMES[name]===sym?`${name}($${'{rm '+sym+'}'}$)`:m);
export const clean=s=>namedElements(cleanRaw(s));
const cleanRaw=s=>{
  const parts=String(s||'').replace(/[^\S\u3000]+/g,' ').split('$').map((p,i)=>i%2?uprightScript(p):p.replace(/[\u223c\u2024]/g,c=>TEXT_FIX[c]));
  if(parts.length%2===0)return parts.join('$').trim();
  const out=[parts[0]];
  for(let i=1;i<parts.length;i+=2){
    const eq=parts[i],after=parts[i+1];
    if(!eq.trim()){out[out.length-1]+=after;continue;}
    const prev=out.length>1?out.at(-2):null,gap=out.at(-1);
    if(prev!==null&&!gap.trim()){out[out.length-2]=prev+(gap?'~':'')+eq;out[out.length-1]=after;}
    else out.push(eq,after);
  }
  let text=out[0];for(let i=1;i<out.length;i+=2)text+=`$${out[i]}$`+out[i+1];
  return text.replace(/ {2,}/g,' ').trim();
};
export const MARK=/^(\[[^\]]{1,12}\]|〔[^〕]{1,12}〕|\((가|나|다|라|마|바|사)\)\s?|[◦○•ㆍ·∙]\s?|[※*]\s?)/;
export const HEAD=/^[\[〔［]\s*([^\]〕］]{1,12}?)\s*[\]〕］]$/;
const CAPTION=/^(\s*\((가|나|다|라|마|바)\)\s*)+$/;
const INDENT=[5.5,17],OPEN_STEP=11;

// 상자: 선 4개(왼·오른 세로선 높이가 같고 아래 가로선이 폭을 덮는 것) 또는 테두리 사각형.
export function frameRects(frames=[]){
  const near=(a,b,t=2.2)=>Math.abs(a-b)<=t,H=[],V=[],R=[];
  for(const f of frames){const [x0,y0,x1,y1]=f.box;
    if(f.type==='rect'){if(f.paint!=='fill'&&x1-x0>60&&y1-y0>14)R.push({box:[x0,y0,x1,y1],titled:false});continue;}
    if(y1-y0<1.5&&x1-x0>6)H.push({y:(y0+y1)/2,x0,x1});else if(x1-x0<1.5&&y1-y0>14)V.push({x:(x0+x1)/2,y0,y1});}
  const cover=(segs,a,b)=>{const s=segs.map(h=>[Math.max(a,h.x0),Math.min(b,h.x1)]).filter(([p,q])=>q>p).sort((m,n)=>m[0]-n[0]);let len=0,end=a;for(const [p,q] of s){if(q<=end)continue;len+=q-Math.max(p,end);end=q;}return len/(b-a);};
  for(const a of V)for(const b of V){if(b.x-a.x<60||!near(a.y0,b.y0)||!near(a.y1,b.y1))continue;
    const top=H.filter(h=>near(h.y,a.y0)),bot=H.filter(h=>near(h.y,a.y1));
    if(cover(bot,a.x,b.x)<.9||cover(top,a.x,b.x)<.3)continue;
    // 사이에 같은 높이 세로선이 있으면 표 칸이다(가장 바깥만 남긴다).
    R.push({box:[a.x,Math.min(a.y0,b.y0),b.x,Math.max(a.y1,b.y1)],titled:cover(top,a.x,b.x)<.97});}
  const same=(p,q)=>p.box.every((v,i)=>Math.abs(v-q.box[i])<2.5);
  return R.filter((r,i)=>R.findIndex(q=>same(q,r))===i);
}
const yOv=(a,b)=>Math.min(a[3],b[3])-Math.max(a[1],b[1]);
const inside=(box,x,y,m=2)=>x>=box[0]-m&&x<=box[2]+m&&y>=box[1]-m&&y<=box[3]+m;
const contains=(a,b,m=2)=>a[0]<=b[0]+m&&a[1]<=b[1]+m&&a[2]>=b[2]-m&&a[3]>=b[3]-m;

// 변환 결과 → 흐름 항목(줄·그림·표). 선지는 뺀다.
export function flowItems(structure){
  const ph=structure.pageHeight,out=[];
  for(const b of structure.blocks||[]){
    if(b.role==='choice')continue;
    if(b.kind==='table'){out.push({k:'table',block:b,box:b.box,role:b.role});continue;}
    for(const r of b.runs||[])if(r.kind==='figure')out.push({k:'figure',run:r,box:r.sourceBox,role:b.role});
    const text=clean(runsText(b.runs));if(!text)continue;
    const L=b.sourceLine;
    out.push({k:'line',role:b.role,label:b.label||'',text,left:L?.left,right:L?.right,base:L&&ph?ph-L.y:null,h:L?.height||10,opening:!!L?.opening,geo:!!L});
  }
  // 쪽 여백의 세로 과목명(물/리/학/II): 다른 줄보다 오른쪽에 있는 1~2글자 줄.
  const body=out.filter(i=>i.k==='line'&&i.geo&&i.right-i.left>40);
  // 본문 오른쪽 끝: 번호 줄(첫 줄)의 끝, 없으면 가장 흔한 줄 끝(여백 글자가 붙어 읽힌 줄에 끌려가지 않게).
  const rights=body.map(i=>Math.round(i.right/3)*3),mode=rights.length?Number([...rights.reduce((m,r)=>m.set(r,(m.get(r)||0)+1),new Map())].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0])+3:Infinity;
  const first=body[0],shared=rights.filter(r=>r===mode-3).length>=2;
  // 평가원 단 폭은 약 317pt(번호 글자 왼쪽 ~ 본문 오른쪽 끝). 모든 줄에 여백 글자가 붙어도 이 폭을 넘지 않게.
  const edge=Math.min(first&&first.right-first.left>150&&!(shared&&first.right>mode+8)?first.right+2:mode,first?first.left+320:Infinity);
  const WM=/^(물|리|화|생|명|과|학|지|구|II|Ⅱ|I|Ⅰ)$/;
  const margin=i=>i.k==='line'&&i.geo&&i.right-i.left<26&&i.left>edge-2&&i.text.replace(/\s/g,'').length<=2;
  // 여백 글자가 본문 줄 끝에 붙어 읽힌 경우: 줄 끝 낱말 하나를 뗀다.
  for(const i of out)if(i.k==='line'&&i.geo&&i.right>edge+10){const t=tokens(i.text);if(t.length>1&&WM.test(t.at(-1))){i.text=t.slice(0,-1).join(' ');i.right=edge;structure.watermark=true;}}
  if(out.some(margin))structure.watermark=true;
  // 그림 부스러기 줄: 홀로 찍힌 '.'과 짧은 수식·글자만 있는 줄.
  const debris=i=>i.k==='line'&&i.role!=='bogi'&&/(^|\s)\.(\s|$)/.test(i.text)&&tokens(i.text).every(t=>t==='.'||/^\$[^$]{1,3}\$$/.test(t)||[...t].length===1);
  return out.filter(i=>!margin(i)&&!debris(i));
}

// 흐름 항목에 상자를 붙인다. 표·그림 테두리, 보기 상자, 글이 없는 상자는 뺀다.
export function assignBoxes(items,frames){
  const tables=items.filter(i=>i.k==='table'&&i.box),figs=items.filter(i=>i.k==='figure'&&i.box);
  let rects=frameRects(frames).filter(r=>!tables.some(t=>contains(r.box,t.box,3)&&contains(t.box,r.box,3))&&!tables.some(t=>contains(t.box,r.box,3))&&!figs.some(f=>contains(f.box,r.box,4)));
  const lineIn=(r,l)=>l.geo&&Number.isFinite(l.base)&&l.left>=r.box[0]-2&&l.right<=r.box[2]+2&&l.base>=r.box[1]&&l.base<=r.box[3]+1;
  rects=rects.filter(r=>!items.some(l=>l.k==='line'&&l.role==='bogi'&&lineIn(r,l))&&items.some(l=>l.k==='line'&&l.role!=='bogi'&&lineIn(r,l)));
  // 가장 바깥 상자만(상자 안 표 칸·작은 상자는 안쪽 내용).
  rects=rects.filter(r=>!rects.some(q=>q!==r&&contains(q.box,r.box,1)&&!contains(r.box,q.box,1)));
  for(const it of items){
    const r=it.k==='line'?rects.find(r=>lineIn(r,it)):it.box?rects.find(r=>inside(r.box,(it.box[0]+it.box[2])/2,(it.box[1]+it.box[3])/2)):null;
    if(r)it.rect=r;
  }
  return rects;
}

// 줄 → 문단. 같은 상자(또는 상자 밖) 안에서만 잇는다.
export function paragraphs(lines,{B}={}){
  const out=[];let cur=null,prev=null;
  const lefts=lines.filter(l=>l.geo&&!l.opening).map(l=>l.left);
  const base=Number.isFinite(B)?B:lefts.length?Math.min(...lefts):null;
  for(const l of lines){
    const t=l.text,d=Number.isFinite(base)&&l.geo?l.left-base:0;
    // (가)·(나)로 시작하는 줄은 앞 줄이 문장 끝이거나 들여쓰기가 바뀔 때만 새 문단(줄바꿈으로 줄 머리에 온 (나)는 잇는다).
    // (가)·(나)로 시작하는 식 줄(→·⇄·=)은 늘 새 문단(10-25 c1_2026_09_13 「◦화학 반응식」 뒤에 반응식 두 줄이 이어 붙음).
    const markStart=MARK.test(t)&&(/^[◦○•ㆍ※*\[〔]/.test(t)||/→|⇄|⇌/.test(t)||!prev||!prev.geo||!l.geo||/([.:?!)\]〕]|다)$/.test(prev.text)||(cur?.mark&&Math.abs(l.left-cur.firstLeft)<=2));
    // 매달린 들여쓰기: ◦·(가)로 시작한 문단의 다음 줄은 더 들여 써도 잇는다.
    const hanging=cur&&cur.mark&&!cur.display&&l.geo&&l.left>cur.firstLeft+3&&(cur.lines.length===1||Math.abs(l.left-prev.left)<2.5)&&!markStart&&!HEAD.test(t);
    const display=d>INDENT[1]&&!hanging&&!(prev&&prev.geo&&Math.abs(l.left-prev.left)<2&&cur?.display);
    // 오른쪽으로 멀리 들여 쓴 괄호 한 줄(「(a～c는 반응 계수)」)은 따로 문단 — 매달린 들여쓰기로 앞 식 줄에 붙었다(10-25).
    const note=/^\(.*\)$/.test(t.replace(/\$/g,'').trim())&&d>INDENT[1]*3;
    let start=note||!cur||l.opening||(prev&&l.role!==prev.role)||markStart||HEAD.test(t)||CAPTION.test(t)||display||cur.display||cur.head||cur.caption;
    // 들여 쓴 줄(본문 왼쪽 + 한 글자): 새 문단. 매달린 들여쓰기는 잇는다.
    if(!start&&!hanging&&d>=INDENT[0]&&d<=INDENT[1]&&!(prev?.geo&&Math.abs(l.left-prev.left)<2))start=true;
    // 들여 쓴 식 줄(→·⇄·=가 든 반응식·속도식, 10-25): 원본 들여쓰기만큼 빈 폭 표시 글자(U+E1B2, 조판기가 전각 빈칸으로 바꿈)를 앞에 둔다 — 왼쪽에 붙어 찍혔다.
    // 오른쪽에 혼자 찍힌 「[3점]」 줄은 식 줄이 아니다.
    // 식 줄이 둘 이상 같은 들여쓰기로 이어지면 둘째 줄은 display로 잡히지 않는다 — 들여쓰기 폭(d)만 본다.
    const pad=d>INDENT[1]&&!hanging&&/→|⇄|⇌|=|ΔH|\\Delta/.test(t)&&!/^\s*\[\s*3\s*점\s*\]\s*$/.test(t)&&Number.isFinite(l.h)&&l.h>0?'\uE1B2'.repeat(Math.min(24,Math.max(0,Math.round(d/(l.h*.5))-1))):'';
    if(start){cur={lines:[l],text:pad+t,firstLeft:l.left,display,head:HEAD.test(t),caption:CAPTION.test(t),mark:MARK.test(t)};out.push(cur);}
    else{cur.lines.push(l);cur.text+=(/[\-‐]$/.test(cur.text)?'':' ')+t;}
    prev=l;
  }
  // 문단 중간에 홀로 찍힌 '.'(그림 점 부스러기)은 뺀다. 문단 끝 '㉠ .'은 둔다.
  return out.map(p=>({...p,text:clean(clean(p.text).replace(/\s\.(?=\s+\S)/g,''))}));
}

// 발문 문장 시작: '?' 앞 마지막 문장 끝 뒤.
export function askStart(text){
  const q=text.indexOf('?');if(q<0)return 0;let st=0;
  for(const m of text.slice(0,q).matchAll(/(다\.|요\.|\.\)|\.)\s+(?=\S)/g))st=m.index+m[0].length;
  return st;
}
export const THREE=/\s*\[\s*3\s*점\s*\]\s*$/;

// 전체 분석: 흐름을 상자·문단으로 묶고 발문·짝 머리줄을 떼어 낸다.
export function analyze(structure,item={}){
  const items=flowItems(structure);
  const rects=assignBoxes(items,structure.frames||[]);
  const geoLines=items.filter(i=>i.k==='line'&&i.geo&&i.role!=='bogi');
  // 문항 번호 줄: 변환기 표시가 없으면 흐름의 첫 줄(번호 글자 위치가 줄의 왼쪽).
  const opening=geoLines.find(l=>l.opening)||geoLines[0];if(opening)opening.opening=true;
  // 번호 줄에 문항 번호 'N.'이 남아 있으면 뗀다(조판기가 번호를 다시 붙인다).
  const no=Number(String(item.id||'').split('_').pop());
  if(opening&&no)opening.text=opening.text.replace(new RegExp(`^${no}\\.\\s*`),'');
  const outside=geoLines.filter(l=>!l.rect&&!l.opening).map(l=>l.left);
  const B=opening?opening.left+OPEN_STEP:outside.length?Math.min(...outside):null;
  // 흐름을 마디(문단 묶음·그림·표·상자)로
  const nodes=[];let run=[];
  // 글 옆 그림·표(가로로 겹치지 않음)는 흐름 순서가 문단 중간에 끼므로 그 글 묶음 뒤로 미룬다.
  const flow=items.filter(it=>!(it.k==='line'&&it.role==='bogi'));
  const besideAt=k=>{const it=flow[k];if(!it.box)return false;const p=flow.slice(0,k).reverse().find(x=>x.k==='line'),n=flow.slice(k+1).find(x=>x.k==='line');
    const apart=l=>l&&l.geo&&l.rect===it.rect&&(l.right<=it.box[0]+2||l.left>=it.box[2]-2)&&Number.isFinite(l.base)&&l.base>=it.box[1]-2&&l.base<=it.box[3]+l.h+14;
    // 앞 줄이 그림 옆이고 다음 줄이 같은 칸에서 이어지면(그림 아래로 흐르는 문단) 문단 뒤로 미룬다.
    return apart(p)&&(apart(n)||!!n&&n.geo&&n.rect===it.rect&&!MARK.test(n.text)&&!HEAD.test(n.text));};
  // 미룬 그림은 그 그림 바로 앞 줄이 든 문단 뒤에 놓는다(실험 상자: 과정 문단 옆 그림이 결과 머리 뒤로 밀리지 않게).
  let deferred=[];
  const flushAll=()=>{
    if(run.length){for(const p of paragraphs(run,{B:run[0].rect?undefined:B})){nodes.push({k:'para',...p,rect:run[0].rect||null});
      for(const d of deferred.filter(d=>p.lines.includes(d.after)))nodes.push(d.node);deferred=deferred.filter(d=>!p.lines.includes(d.after));}run=[];}
    nodes.push(...deferred.map(d=>d.node));deferred=[];};
  for(const [k,it] of flow.entries()){
    if(it.k==='line'&&(!run.length||run[0].rect===it.rect)){run.push(it);continue;}
    if(it.k!=='line'&&run.length&&besideAt(k)){deferred.push({node:{...it,rect:it.rect||null},after:run.at(-1)});continue;}
    flushAll();
    if(it.k==='line'){run.push(it);continue;}
    nodes.push({...it,rect:it.rect||null});
  }
  flushAll();
  // 이어진 그림·표는 위→아래, 같은 높이면 왼→오른 순서로.
  for(let i=0;i<nodes.length;){if(nodes[i].k==='para'){i++;continue;}let j=i;while(j<nodes.length&&nodes[j].k!=='para'&&nodes[j].rect===nodes[i].rect)j++;
    const seg=nodes.slice(i,j);if(seg.every(n=>n.box))seg.sort((a,b)=>yOv(a.box,b.box)>4?a.box[0]-b.box[0]:a.box[1]-b.box[1]);nodes.splice(i,j-i,...seg);i=j;}
  // 발문
  let ask='',header=null;
  const askRole=nodes.findIndex(n=>n.k==='para'&&n.lines.some(l=>l.role==='ask'));
  let ai=-1;
  if(askRole>=0)ai=askRole;
  else for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];if(n.k==='para'&&!n.rect&&n.text.includes('?')){ai=i;break;}}
  if(ai<0){for(let i=nodes.length-1;i>=0;i--)if(nodes[i].k==='para'&&!nodes[i].rect){ai=i;break;}}
  let pre=nodes,post=[];
  if(ai>=0){
    const n=nodes[ai],st=n.lines[0].role==='ask'?0:askStart(n.text);
    const head=st>0?n.text.slice(0,st).trim():'';
    const askParts=[n.text.slice(st).trim()];
    pre=nodes.slice(0,ai);if(head)pre.push({...n,text:head,lines:n.lines});
    for(const m of nodes.slice(ai+1)){
      if(m.k==='para'&&!m.rect&&(item.form==='pair'||item.choiceShape==='table')&&!header&&isHeader(m.text)){header=headerCells(m.text);continue;}
      if(m.k==='para'&&!m.rect&&!m.display&&!m.caption&&!m.head)askParts.push(m.text);else post.push(m);
    }
    ask=clean(askParts.join(' '));
  }
  if(!header&&(item.form==='pair'||item.choiceShape==='table')){
    // 머리줄이 발문 앞에 온 경우(드묾)
    const i=pre.findIndex(m=>m.k==='para'&&!m.rect&&isHeader(m.text));if(i>=0){header=headerCells(pre[i].text);pre.splice(i,1);}
  }
  // 오른쪽 끝에 홀로 찍힌 [3점] 줄(그림 뒤로 밀린 경우 포함)
  let lone=false;for(const list of [pre,post])for(let k=list.length-1;k>=0;k--)if(list[k].k==='para'&&/^\[\s*3\s*점\s*\]$/.test(list[k].text)){list.splice(k,1);lone=true;}
  const three=lone||THREE.test(ask)||/\[\s*3\s*점\s*\]/.test(ask);ask=ask.replace(/\s*\[\s*3\s*점\s*\]\s*/g,' ').trim();
  return {items,rects,nodes:[...pre,...post],after:post,ask,three,header,B,bodyH:opening?.h||null};
}

// 선지표 머리줄: 짧은 낱말 2~6개(㉠ ㉡, A B C, (가) (나), 수식 한 덩이 등).
export function isHeader(t){const c=headerCells(t);return c.length>=2&&c.length<=6&&c.every(x=>x.replace(/\$[^$]*\$/g,'X').length<=12)&&!/[.?]$/.test(t);}
export function headerCells(t){return tokens(t);}
// 공백으로 나누되 $…$ 수식 안 공백은 나누지 않는다.
export function tokens(t){const out=[];let cur='',eq=false;for(const ch of String(t).trim()){if(ch==='$')eq=!eq;if(/\s/.test(ch)&&!eq){if(cur)out.push(cur);cur='';}else cur+=ch;}if(cur)out.push(cur);return out;}

// 짝 고르기 선지표: 줄의 낱말 위치로 열을 맞춘다. 선지가 여러 단(① ② 한 줄)이면 단마다 같은 머리줄이 반복된다.
// 반환: {header:[…], rows:[[…]×5]} 또는 null.
export function pairTable(structure){
  const L=(structure.lineCells||[]).filter(l=>l.words?.length).map(l=>({y:l.y,h:l.height||10,words:l.words.map(w=>({x0:w.x0,x1:w.x1,t:clean(runsText(w.runs))})).filter(w=>w.t&&!/^￼/.test(w.t))})).filter(l=>l.words.length).sort((a,b)=>b.y-a.y);
  const first=L.findIndex(l=>l.words.some(w=>/^①/.test(w.t)));if(first<0)return null;
  const isMark=l=>l.words.some(w=>/^[①②③④⑤]/.test(w.t));
  let last=first;while(last+1<L.length&&!L[last].words.some(w=>/^⑤/.test(w.t)))last++;
  // 두 줄로 쓴 선지 칸(번호 줄 위아래에 반 줄씩): 번호 줄과 가까운 번호 없는 줄도 선지 영역에 넣는다.
  let top=first;while(top-1>=0&&!isMark(L[top-1])&&L[top-1].y-L[first].y<L[first].h*1.05)top--;
  let bot=last;while(bot+1<L.length&&!isMark(L[bot+1])&&L[last].y-L[bot+1].y<L[last].h*1.05)bot++;
  const rows=[],markLines=L.slice(first,last+1).filter(isMark);
  for(const l of markLines){let cur=null;
    for(const w of l.words){const m=w.t.match(/^([①②③④⑤])\s*(.*)$/);
      if(m){cur={mark:m[1],x:w.x0,y:l.y,words:[]};rows.push(cur);if(m[2]){const k=(w.x1-w.x0)*(1-[...m[2]].length/[...w.t].length);cur.words.push({x0:w.x0+k,x1:w.x1,t:m[2],y:l.y});}}
      else if(cur)cur.words.push({...w,y:l.y});}}
  if(rows.length!==5)return null;
  const starts=[];for(const x of rows.map(r=>r.x).sort((a,b)=>a-b))if(!starts.length||x-starts.at(-1)>6)starts.push(x);
  const blockOf=x=>{let k=0;starts.forEach((s,i)=>{if(x>=s-4)k=i;});return k;};
  const center=w=>(w.x0+w.x1)/2;
  for(const l of L.slice(top,bot+1).filter(l=>!isMark(l))){
    const ml=markLines.reduce((a,b)=>Math.abs(b.y-l.y)<Math.abs(a.y-l.y)?b:a);
    for(const w of l.words){const r=rows.find(r=>r.y===ml.y&&blockOf(r.x)===blockOf(center(w)));if(r)r.words.push({...w,y:l.y});}}
  for(const r of rows)r.words.sort((a,b)=>b.y-a.y||a.x0-b.x0);
  // 머리줄: 첫 선지 줄 바로 위, 짧은 낱말들, 물음표 없음.
  let header=null;const up=L[top-1];
  if(up&&up.y-L[top].y<L[top].h*3.2&&up.words.length>=2&&up.words.every(w=>w.t.replace(/\$[^$]*\$/g,'X').length<=14)&&!/[?.]$/.test(up.words.at(-1).t)){
    const own=up.words.filter(w=>blockOf(center(w))===0);
    if(own.length>=1)header=own.map(w=>({t:w.t,c:center(w)-starts[0]}));
  }
  // 머리줄 글자(A·B·C…)가 첫 선지 줄 낱말 끝 수식에 붙어 읽힌 경우: '강자성체$A$', '$XA$선'.
  if(!header){const r1=rows[0].words,HM=/^(.*?)\$([^$]*?)([A-Z])\$(\S{0,3})$/;
    const ms=r1.map(w=>w.t.match(HM));
    if(r1.length>=2&&ms.every(Boolean)&&ms.every((m,i)=>m[3].charCodeAt(0)===ms[0][3].charCodeAt(0)+i)){
      header=ms.map((m,i)=>({t:`$${m[3]}$`,c:center(r1[i])-starts[0]}));
      // 같은 줄의 다른 단(②)에도 같은 머리 글자가 붙어 있다.
      for(const r of rows.filter(r=>r.y===rows[0].y))for(const w of r.words){const m=w.t.match(HM);if(m&&/^[A-Z]$/.test(m[3]))w.t=clean(m[1]+(m[2]?`$${m[2]}$`:'')+m[4]);}}}
  if(!header){// 머리줄 없음: 첫 단 낱말 중심을 묶어 열을 만든다.
    const cs=rows.flatMap(r=>r.words.map(w=>center(w)-starts[blockOf(r.x)])).sort((a,b)=>a-b),cl=[];
    for(const c of cs){if(cl.length&&c-cl.at(-1).at(-1)<14)cl.at(-1).push(c);else cl.push([c]);}
    header=cl.map(g=>({t:'',c:g.reduce((a,b)=>a+b,0)/g.length}));
  }
  const cols=header.length;
  const out=rows.map(r=>{const cells=Array(cols).fill('');const s=starts[blockOf(r.x)];
    for(const w of r.words){const c=center(w)-s;let j=0;header.forEach((h,i)=>{if(Math.abs(h.c-c)<Math.abs(header[j].c-c))j=i;});cells[j]=clean(cells[j]+' '+w.t);}
    return cells;});
  return {header:header.map(h=>h.t),rows:out};
}

// 수식 안 괄호: 평가원 PDF에서 ( )는 본문 글꼴로 찍힌다(원본 글 채점 기준과 같게). 수식 밖 글로 뺀다.
// '$(mol)$' → '($mol$)', '$A(g)$' → '$A$($g$)'. 상태 기호 글자(g·l·s)는 본문 글꼴로 찍힌 것({rm g}, 변환기 표시)만 글로 뺀다. 중괄호 안(분수·\text)은 그대로.
export function splitEquationParens(str){
  return String(str||'').replace(/\$([^$\n]+)\$/g,(all,s)=>{
    if(/\\left|\\right|\\begin/.test(s)||!/[()]/.test(s))return all;
    const parts=[];let math='',depth=0;
    const push=(kind,v)=>{if(!v)return;const last=parts.at(-1);if(last?.kind===kind)last.v+=v;else parts.push({kind,v});};
    for(let i=0;i<s.length;i++){const ch=s[i];
      if(ch==='\\'){const m=s.slice(i).match(/^\\[A-Za-z]+|^\\./);math+=m[0];i+=m[0].length-1;continue;}
      if(ch==='{')depth++;if(ch==='}')depth--;
      if(depth===0&&(ch==='('||ch===')')){
        push('math',math);math='';
        // 본문 글꼴 상태 기호 '({rm g})' → 글 '(g)'
        const st=ch==='('&&s.slice(i).match(/^\(\{rm\s+([A-Za-z]{1,3})\}\)/);
        if(st){push('text',`(${st[1]})`);i+=st[0].length-1;continue;}
        push('text',ch);continue;}
      math+=ch;}
    push('math',math);
    if(depth!==0)return all;
    return parts.map(p=>p.kind==='text'?p.v:p.v.trim()?`$${p.v.trim()}$`:p.v).join('');
  });
}
// 문항 안 모든 글에 적용.
export function mapQuestionText(q,f){// 자료표 칸은 변환기 그대로(작은 글꼴 표).
  q.ask=f(q.ask);
  for(const b of q.blocks){if(typeof b.text==='string')b.text=f(b.text);for(const l of b.lines||[])l.text=f(l.text);}
  for(const c of q.choices)c.text=f(c.text);
  for(const r of q.choiceTable?.cells||[])for(const c of r)if(typeof c.value==='string')c.value=f(c.value);
}
