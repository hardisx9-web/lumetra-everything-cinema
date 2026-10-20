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

for(let i=0;i<120;i++){
 const html=posterMarkup({id:`catalogue-${i}`,title:`Film <${i}>`,year:1900+i,director:'Director & Author'});
 assert(html.includes('Authentic film artwork pending review'));
 assert(!html.includes('Original illustrative cover'));
 assert(!html.includes('<svg'));
 assert(!html.includes('/visuals/'));
 assert(!html.includes('<'+i+'>'));
 assert(html.includes('Film &lt;'));
 assert(!html.includes('<img '));

}

console.log(`PASS ${deepResearchEssays.length} expanded cited research essays, ${Object.keys(researchedDossiers).length} dossiers and 120 escaped artwork-pending states (no rejected illustrative fallback)`);
