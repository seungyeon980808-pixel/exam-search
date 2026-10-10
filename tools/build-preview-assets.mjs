// Build display previews from the existing, locally retained PDFs. No source index or PDF is changed.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error('Usage: node tools/build-preview-assets.mjs <local source folder>');
const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(await read('data/catalog.json'));
const index = JSON.parse(await read('data/questions.json'));
const recipe = digest(Buffer.concat(await Promise.all(['pdf-viewer.mjs','preview-crop.mjs'].map(read)))+'scale=1.6');
let previous;
try { previous = JSON.parse(await read('data/preview-assets.json')); } catch {}
const manifest = { schema: 'exam-previews-v1', recipe, sourceRevision: catalog.sourceRevision, questions: {}, files: {}, errors: [] };
const entries = await readdir(join(sourceRoot, '기출확장_국영수사탐'), { recursive: true, withFileTypes: true });
const paths = new Map(entries.filter(e=>e.isFile()&&e.name.endsWith('.pdf')).map(e=>[e.name.match(/_([a-f0-9]{12})\.pdf$/u)?.[1], join(e.parentPath || e.path,e.name)]));
const sources = new Map();
for(const file of catalog.files) {
 const hash=file.pdfFile.match(/_([a-f0-9]{12})\.pdf$/u)?.[1];
 sources.set(file.pdfFile,hash ? paths.get(hash) : join(sourceRoot,'pdfs',file.pdfFile));
}
await mkdir(new URL('previews/',root),{recursive:true});
await mkdir(new URL('data/',root),{recursive:true});
await mkdir(new URL('_work/',root),{recursive:true});
await writeFile(new URL('_work/preview-build.html',root),'<!doctype html><meta charset="utf-8"><title>Local preview build</title>');
function webpSize(bytes) {
 let offset=12;
 while(offset+8<=bytes.length) {
  const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),data=offset+8;
  if(type==='VP8X')return [1+bytes.readUIntLE(data+4,3),1+bytes.readUIntLE(data+7,3)];
  if(type==='VP8 ')return [bytes.readUInt16LE(data+6)&0x3fff,bytes.readUInt16LE(data+8)&0x3fff];
  if(type==='VP8L'){const bits=bytes.readUInt32LE(data+1);return [1+(bits&0x3fff),1+((bits>>>14)&0x3fff)];}
  offset=data+length+(length%2);
 }
 throw new Error('Invalid WebP');
}
async function existing(path) {
 try {const bytes=await read(path),[width,height]=webpSize(bytes);return {path,width,height,bytes:bytes.length};}catch{return null;}
}
const jobs=[];
for(const file of catalog.files) {
 const questions=index.items.filter(q=>q.pdfFile===file.pdfFile);
 const todo=[];
 for(const q of questions) {
  if(!/^[-\w]+$/u.test(q.id))throw new Error('Unsafe question ID');
  const asset=await existing(`cards/${q.id}.webp`);
  if(asset)manifest.questions[q.id]=asset;else todo.push(q);
 }
 const thumbnail=await existing(`thumbnails/${file.pdfFile.replace(/\.pdf$/u,'')}.webp`);
 if(thumbnail)manifest.files[file.pdfFile]=thumbnail;
 if(todo.length||!thumbnail)jobs.push({file,items:todo,thumbnail:!thumbnail});
}
const browser=await chromium.launch({headless:true});
let next=0,completed=0;
let manifestWrite=Promise.resolve();
function saveManifest() {
 manifestWrite=manifestWrite.then(async()=>{
 await writeFile(new URL('data/preview-assets.json.tmp',root),JSON.stringify(manifest));
 await rename(new URL('data/preview-assets.json.tmp',root),new URL('data/preview-assets.json',root));
 });
 return manifestWrite;
}
try {
 await Promise.all(Array.from({length:4},async()=>{
  const context=await browser.newContext(),page=await context.newPage();
  await page.route(/google-drive-gateway/u,async route=>{
   const name=decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
   const file=catalog.files.find(f=>basename(f.publicPath)===name);
   const path=file&&sources.get(file.pdfFile);
   if(!path){await route.fulfill({status:404,body:'Missing local source'});return;}
   try {await route.fulfill({status:200,contentType:'application/pdf',body:await readFile(path)});}
   catch {await route.fulfill({status:404,body:'Missing local source'});}
  });
  await page.goto(new URL('_work/preview-build.html',base).href);
  await page.evaluate(async()=>{await (await import('../data.mjs?v=library-release-20261010-1')).browserCatalog();});
  while(next<jobs.length) {
   const job=jobs[next++];
   try {
    const source=await readFile(sources.get(job.file.pdfFile)),sourceHash=digest(source);
    const generate=async(q,file=false)=>{
     const old=(file?previous?.files:previous?.questions)?.[file?job.file.pdfFile:q.id];
     if(previous?.sourceRevision===manifest.sourceRevision&&previous?.recipe===recipe&&old?.sourceHash===sourceHash&&await existing(old.path))return old;
     const image=await page.evaluate(async({q,name,file})=>{
      const viewer=await import('../pdf-viewer.mjs?v=library-release-20261010-1');
      const url=await(file?viewer.renderFileThumbnail(name):viewer.renderQuestion(q,1.6));
      try {const blob=await(await fetch(url)).blob();const bmp=await createImageBitmap(blob);
       const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
       const result={data,width:bmp.width,height:bmp.height};bmp.close();return result;
      }finally{URL.revokeObjectURL(url);}
     },{q,name:job.file.pdfFile,file});
     const bytes=Buffer.from(image.data,'base64'),hash=digest(bytes).slice(0,16);
     const path=`previews/${file?'file-'+sourceHash.slice(0,16):q.id}-${hash}.webp`;
     await writeFile(new URL(path,root),bytes);
     return {path,width:image.width,height:image.height,bytes:bytes.length,sourceHash};
    };
    for(let i=0;i<job.items.length;i+=2)await Promise.all(job.items.slice(i,i+2).map(async q=>{
     try{manifest.questions[q.id]=await generate(q);}catch(error){manifest.errors.push({id:q.id,message:error.message});}
    }));
    if(job.thumbnail)manifest.files[job.file.pdfFile]=await generate(null,true);
   }catch(error){manifest.errors.push({file:job.file.pdfFile,message:error.message});}
   completed++;
   if(completed%20===0||completed===jobs.length){await saveManifest();console.log(JSON.stringify({completed,total:jobs.length,questions:Object.keys(manifest.questions).length,files:Object.keys(manifest.files).length,errors:manifest.errors.length}));}
  }
  await context.close();
 }));
}finally{await browser.close();await saveManifest();}
console.log(JSON.stringify({questions:Object.keys(manifest.questions).length,files:Object.keys(manifest.files).length,errors:manifest.errors}));
if(manifest.errors.length)process.exitCode=1;
