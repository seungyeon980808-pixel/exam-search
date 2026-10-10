// Derived browser assets only. The source index and conversion metadata stay intact.
import { readFile, mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { catalogFiles,compactSearchRecord } from '../search.mjs';
import {createCatalogMetadata} from '../catalog-metadata.mjs';
const root = new URL('../', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(`data/${name}.json`, root), 'utf8'));
const [index, records, synonyms] = await Promise.all(['questions', 'files', 'synonyms'].map(read));
const digest = value => createHash('sha256').update(value).digest('hex');
const sourceRevision=digest(JSON.stringify([index,records,synonyms]));
let previews;
try { previews = JSON.parse(await readFile(new URL('data/preview-assets.json',root),'utf8')); }
catch(error) { if(error.code!=='ENOENT')throw error; }
if(previews && (previews.schema!=='exam-previews-v1'||previews.sourceRevision!==sourceRevision))
 throw new Error('Preview assets do not match the current source index. Rebuild them first.');
const directory = new URL('data/browser/', root);
await mkdir(directory, {recursive:true});
const keep = new Set();
async function asset(label, value) {
  const json = JSON.stringify(value), hash = digest(json), name = `${label}-${hash.slice(0,16)}.json`;
  keep.add(name); await writeFile(new URL(name, directory), json);
  return {path:`data/browser/${name}`, sha256:hash, bytes:Buffer.byteLength(json)};
}
const {subjects,groups,facets,status}=createCatalogMetadata(index);
const sourceOrder=new Map(index.items.map((q,index)=>[q.id,index]));
const shards={};
for(const {value} of subjects){
 const items=index.items.filter(q=>q.subject===value);
 const browse=items.map(q=>{
  const {text,curriculum,...rest}=q;
  // Keep the small fields required for profile/unit filtering and card display.
  const fields=['id','subject','subjectLabel','year','month','no','exam','title','textQuality','pdfFile','page','box','displayBox','cardPath','tags','parts','track','variant'];
  const item=Object.fromEntries(fields.filter(k=>rest[k]!==undefined).map(k=>[k,rest[k]]));
  if(curriculum)item.curriculum={framework:curriculum.framework,unit:curriculum.unit,
   standards:(curriculum.standards||[]).map(s=>({code:s.code,unit:s.unit}))};
  const preview=previews?.questions?.[q.id];
  if(preview)Object.assign(item,{cardPath:preview.path,cardWidth:preview.width,cardHeight:preview.height});
  item._sourceOrder = sourceOrder.get(q.id);
  return item;
 });
 shards[value]={browse:await asset(`${value}-list`,browse),detail:await asset(`${value}-detail`,items),
  search:{...await asset(`${value}-search`,items.map(q=>compactSearchRecord(q,synonyms.map||{}))),format:'compact-search-v1'}};
}
const fileProfiles=new Map();
for(const q of index.items) {
  const profiles=fileProfiles.get(q.pdfFile)||new Map();
  const track=q.track||'all',variant=q.variant||'single',key=`${track}:${variant}`;
  const profile=profiles.get(key)||{track,variant,questionCount:0,firstMatchPage:q.page};
  profile.questionCount++;profile.firstMatchPage=Math.min(profile.firstMatchPage,q.page);
  profiles.set(key,profile);fileProfiles.set(q.pdfFile,profiles);
}
const files=catalogFiles(records,index.items).map(f=>({...f,...records.find(r=>r.pdfFile===f.pdfFile),profiles:[...(fileProfiles.get(f.pdfFile)||new Map()).values()],
 ...(previews?.files?.[f.pdfFile]?{thumbnailPath:previews.files[f.pdfFile].path}:{})}));
const contents={schema:'exam-browser-v3',sourceRevision,status,files,facets,shards,synonyms:synonyms.map||{}};
const catalog={...contents,revision:digest(JSON.stringify(contents))};
await writeFile(new URL('data/catalog.json',root),JSON.stringify(catalog));
for(const old of await readdir(directory))if(old.endsWith('.json')&&!keep.has(old))await unlink(new URL(old,directory));
console.log(JSON.stringify({catalogBytes:Buffer.byteLength(JSON.stringify(catalog)),subjects:subjects.length,questions:index.items.length,
 browseBytes:Object.values(shards).reduce((n,s)=>n+s.browse.bytes,0),detailBytes:Object.values(shards).reduce((n,s)=>n+s.detail.bytes,0),
 searchBytes:Object.values(shards).reduce((n,s)=>n+s.search.bytes,0)}));
