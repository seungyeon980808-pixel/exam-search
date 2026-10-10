import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('./',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root)));
const index=read('data/questions.json'),catalog=read('data/catalog.json'),assets=read('data/preview-assets.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('all indexed questions and papers have source-matched display previews',()=>{
 assert.equal(assets.sourceRevision,catalog.sourceRevision);
 assert.equal(assets.schema,'exam-previews-v1');assert.deepEqual(assets.errors,[]);
 assert.equal(Object.keys(assets.questions).length,index.items.length);
 for(const q of index.items)assert(assets.questions[q.id]);
 assert.equal(Object.keys(assets.files).length,catalog.files.length);
 for(const f of catalog.files)assert(assets.files[f.pdfFile]);
});
test('every generated preview is present and content-addressed; source and detail remain intact',()=>{
 for(const asset of [...Object.values(assets.questions),...Object.values(assets.files)]) {
  assert.match(asset.path,/^(previews|cards|thumbnails)\/[-\w .가-힣]+\.webp$/u);
  assert(asset.width>0&&asset.height>0&&asset.bytes>0);
  const bytes=readFileSync(new URL(asset.path,root));assert.equal(bytes.length,asset.bytes);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  if(asset.path.startsWith('previews/'))assert(asset.path.endsWith(hash(bytes).slice(0,16)+'.webp'));
 }
 const details=[];
 for(const shard of Object.values(catalog.shards)) {
  const browse=read(shard.browse.path);details.push(...read(shard.detail.path));
  for(const q of browse) {
   const asset=assets.questions[q.id];assert.equal(q.cardPath,asset.path);
   assert.equal(q.cardWidth,asset.width);assert.equal(q.cardHeight,asset.height);
  }
 }
 const byId=new Map(details.map(q=>[q.id,q]));for(const q of index.items)assert.deepEqual(byId.get(q.id),q);
 for(const f of catalog.files)assert.equal(f.thumbnailPath,assets.files[f.pdfFile].path);
});
