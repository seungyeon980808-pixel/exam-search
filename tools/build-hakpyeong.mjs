// OmO 작성. 기존 추출 자료와 WebP를 재사용하며 원본 PDF는 변경하지 않는다.
// node tools/build-hakpyeong.mjs <data-source> [cards directory]
import {readFile,mkdir,writeFile,copyFile,readdir,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compactSearchRecord,catalogFiles} from '../search.mjs';
import {createCatalogMetadata} from '../catalog-metadata.mjs';
const source=process.argv[2],cards=process.argv[3]||join(source||'', 'cards');
if(!source)throw new Error('학평 추출 자료 폴더를 지정하세요.');
const root=fileURLToPath(new URL('../',import.meta.url)),out=join(root,'data/hakpyeong');
const manifest=JSON.parse(await readFile(join(source,'index.json'),'utf8'));
const synonyms=JSON.parse(await readFile(join(root,'data/synonyms.json'),'utf8')).map||{};
const documents=new Map(manifest.documents.map(doc=>[doc.file,doc]));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(out,{recursive:true});
await mkdir(join(root,'cards'),{recursive:true});
const all=[],shards={},keep=new Set(['catalog.json']);
function dimensions(bytes) {
 for(let offset=12;offset+8<=bytes.length;) {
  const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),at=offset+8;
  if(type==='VP8 ')return [bytes.readUInt16LE(at+6)&0x3fff,bytes.readUInt16LE(at+8)&0x3fff];
  if(type==='VP8X')return [1+bytes.readUIntLE(at+4,3),1+bytes.readUIntLE(at+7,3)];
  if(type==='VP8L'){const bits=bytes.readUInt32LE(at+1);return [1+(bits&0x3fff),1+((bits>>>14)&0x3fff)];}
  offset=at+size+(size%2);
 }
 throw new Error('WebP 크기를 읽지 못했습니다.');
}
async function asset(name,value) {
 const bytes=gzipSync(JSON.stringify(value),{level:9}),sha256=digest(bytes);
 const path=`data/hakpyeong/${name}-${sha256.slice(0,16)}.json.gz`;
 keep.add(path.split('/').at(-1));
 await writeFile(join(root,path),bytes);
 return {path,sha256,bytes:bytes.length};
}
let cardBytes=0;
for(const [subject,subjectLabel,count] of manifest.subjects) {
 const rows=JSON.parse(await readFile(resolve(source,`${subject}.json`),'utf8'));
 if(rows.length!==count)throw new Error(`${subject}: 원본 문항 수가 다릅니다.`);
 const items=[];
 for(const row of rows) {
  const [id,year,month,no,page,box,pdfFile,parts,tags,hasFigure,record,text]=row;
  if(!/^[pbce][12]_\d{4}_(03|04|05|07|10)_\d{2}$/u.test(id))throw new Error(`문항 ID 형식 오류: ${id}`);
  const doc=documents.get(pdfFile);
  if(!doc||!manifest.files[pdfFile])throw new Error(`원본 경로 누락: ${pdfFile}`);
  const original=join(cards,`${id}.webp`),bytes=await readFile(original);
  const [cardWidth,cardHeight]=dimensions(bytes),relative=`cards/${id}.webp`;
  await copyFile(original,join(root,relative));cardBytes+=bytes.length;
  // 학평 그림은 같은 커밋의 GitHub 원본 호스트에서 제공해 Pages 1 GB 제한을 지킨다.
  const cardPath=`https://raw.githubusercontent.com/seungyeon980808-pixel/exam-search/main/${relative}?v=${digest(bytes).slice(0,16)}`;
  const exam=`${year}학년도 ${month}월 학평`;
  const displayBox=[box[0],box[1],box[2],Math.min(box[3],box[1]+cardHeight/2)];
  const item={id,subject,subjectLabel,year,month,no,page,box,displayBox,pdfFile,parts,tags,text,
   hasFigure:!!hasFigure,source:'hakpyeong',exam,title:`${exam} ${subjectLabel} ${no}번`,
   cardPath,cardWidth,cardHeight,textQuality:doc.scanPages?'ocr':'readable'};
  if(record)item.record=record;
  items.push(item);
 }
 const browse=items.map(({text,record,...item},index)=>({...item,_sourceOrder:all.length+index}));
 shards[`hp_${subject}`]={browse:await asset(`${subject}-list`,browse),
  detail:await asset(`${subject}-detail`,items),
  search:{...await asset(`${subject}-search`,items.map(q=>compactSearchRecord(q,synonyms))),format:'compact-search-v1'}};
 all.push(...items);
}
const records=manifest.documents.map(doc=>({pdfFile:doc.file,publicPath:doc.publicPath,pageCount:doc.pages}));
const files=catalogFiles(records,all).map(file=>{
 const doc=documents.get(file.pdfFile);
 return {...file,source:'hakpyeong',publicPath:doc.publicPath,pageCount:doc.pages,
  thumbnailPath:`thumbnails/${file.pdfFile.replace(/\.pdf$/u,'')}.webp`,
  profiles:[{track:'all',variant:'single',questionCount:file.questionCount,firstMatchPage:1}]};
});
const index={items:all,pdfCount:files.length,questionCount:all.length,incomplete:[]};
const {status,facets}=createCatalogMetadata(index);
const contents={schema:'exam-browser-v3',author:'OmO 작성',sourceRevision:digest(JSON.stringify([manifest,all])),
 status,files,facets,shards,synonyms};
const catalog={...contents,revision:digest(JSON.stringify(contents))};
await writeFile(join(out,'catalog.json'),JSON.stringify(catalog));
const retired=join(homedir(),'.Trash',`exam-search-hakpyeong-${Date.now()}`);
for(const name of await readdir(out))if(!keep.has(name)){
 await mkdir(retired,{recursive:true});await rename(join(out,name),join(retired,name));
}
console.log(JSON.stringify({author:'OmO 작성',questions:all.length,pdfs:files.length,cardBytes,
 catalogBytes:Buffer.byteLength(JSON.stringify(catalog)),shardBytes:Object.values(shards).reduce((n,s)=>n+s.browse.bytes+s.detail.bytes+s.search.bytes,0)}));
