import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { compactSearchRecord } from '../search.mjs';
import { createCatalogMetadata } from '../catalog-metadata.mjs';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [{items}, records, quality, synonymsFile] = await Promise.all([
  'data/imyong/questions.json', 'data/imyong/files.json', 'data/imyong/quality.json', 'data/synonyms.json',
].map(read));
const synonyms = synonymsFile.map || {};
const digest = value => createHash('sha256').update(value).digest('hex');
const out = new URL('data/imyong/', root);
await mkdir(out, {recursive: true});
async function asset(label, value) {
  const bytes = gzipSync(JSON.stringify(value), {level: 9});
  const sha256 = digest(bytes), path = `data/imyong/${label}-${sha256.slice(0,16)}.json.gz`;
  await writeFile(new URL(path, root), bytes);
  return {path, sha256, bytes: bytes.length};
}
const index = {items, pdfCount: records.length, questionCount: items.length, incomplete: quality.incomplete};
const {status, facets} = createCatalogMetadata(index);
const shards = {};
const sourceOrder = new Map(items.map((q,i)=>[q.id,i]));
for (const {value} of status.subjects) {
  const questions = items.filter(q => q.subject === value);
  const browse = questions.map(({text,questionText,sourceUrl,sourcePage,classificationMethod,...q}) => ({...q, _sourceOrder: sourceOrder.get(q.id)}));
  shards[value] = {
    browse: await asset(`${value}-list`, browse),
    detail: await asset(`${value}-detail`, questions),
    search: {...await asset(`${value}-search`, questions.map(q => compactSearchRecord(q, synonyms))), format: 'compact-search-v1'},
  };
}
const files = records.map(file => ({...file, profiles: [{track:'all', variant:'single',
  questionCount:file.questionCount, firstMatchPage:Math.min(...items.filter(q=>q.pdfFile===file.pdfFile).map(q=>q.page))}]}));
const contents = {schema:'exam-browser-v3', sourceRevision:digest(JSON.stringify([items, records])),
  status, files, facets, shards, synonyms};
const catalog = {...contents, revision:digest(JSON.stringify(contents))};
await writeFile(new URL('catalog.json', out), JSON.stringify(catalog));
console.log(JSON.stringify({papers: files.length, questions: items.length,
  pedagogy: items.filter(q=>q.domain==='pedagogy').length, catalogBytes: Buffer.byteLength(JSON.stringify(catalog)),
  searchBytes: Object.values(shards).reduce((n,s)=>n+s.search.bytes,0)}));
