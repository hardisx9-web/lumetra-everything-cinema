import assert from 'node:assert/strict';
import {deepResearchEssays} from '../catalogue-editorial/deep-research.js';
import {researchedDossiers} from '../catalogue-editorial/dossier-research.js';
import {posterMarkup} from '../public/artwork-ui.js';
const ids=new Set();
assert.equal(deepResearchEssays.length,5);
for(const article of deepResearchEssays){
  assert(!ids.has(article.id),'duplicate research ID');ids.add(article.id);
  assert.equal(article.editorial_status,'RESEARCHED_DRAFT');
  assert(article.sections.length>=5);
  assert(article.paragraphs.join(' ').trim().split(/\s+/).length >= 520);
  assert(article.sources.length>=2);
  for(const source of article.sources) assert(new URL(source.url).protocol==='https:');
}
assert.equal(Object.keys(researchedDossiers).length,4);
for(const [id,entry] of Object.entries(researchedDossiers)){
 assert(entry.paragraphs.length>=3,`${id} paragraphs`);
 assert(entry.sources.length>=2,`${id} provenance`);
 assert(ids.has(entry.crossEssay),`${id} linked feature`);
}
let variants=new Set();
for(let i=0;i<120;i++){
 const html=posterMarkup({id:`catalogue-${i}`,title:`Film <${i}>`,year:1900+i,director:'Director & Author'});
 assert(html.includes('Original illustrative cover · not a historical poster'));
 assert(!html.includes('<'+i+'>'));
 assert(html.includes('Film &lt;'));
 assert(!html.includes('<img '));
 const variant=/motif-([a-z]+)/.exec(html)?.[1];assert(variant);variants.add(variant);
}
assert(variants.size>=6,`only ${variants.size} cover motifs`);
console.log(`PASS ${deepResearchEssays.length} expanded cited research essays, ${Object.keys(researchedDossiers).length} dossiers and ${variants.size} stable illustrative cover motifs`);
