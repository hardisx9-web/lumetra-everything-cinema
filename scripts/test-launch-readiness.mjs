import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchResearchEssays } from '../catalogue-editorial/launch-research.js';
import { deepResearchEssays } from '../catalogue-editorial/deep-research.js';
import { researchEssays } from '../catalogue-editorial/research.js';
import { atlasEssays } from '../catalogue-editorial/editorial-atlas.js';
const all = [...deepResearchEssays,...launchResearchEssays,...researchEssays.filter(a=>![...deepResearchEssays,...launchResearchEssays].some(b=>b.id===a.id)),...atlasEssays.filter(a=>![...deepResearchEssays,...launchResearchEssays].some(b=>b.id===a.id))];
assert.equal(new Set(all.map(a=>a.id)).size,all.length,'Editorial slugs must be unique');
assert.equal(launchResearchEssays.length,4);
const sources = new Set();
for(const essay of [...launchResearchEssays,...deepResearchEssays]) {
 assert.equal(essay.editorial_status,'RESEARCHED_DRAFT');
 assert(essay.sections.length>=5,`Missing chapters: ${essay.id}`);
 assert(essay.paragraphs.join(' ').split(/\s+/).length>=500,`Too short: ${essay.id}`);
 assert(essay.sources.length>=2,`Needs independent citations: ${essay.id}`);
 for(const {url,label} of essay.sources){assert(new URL(url).protocol==='https:');assert(label.length>6);sources.add(url);}
}
const main=readFileSync('public/app.js','utf8');
const css=readFileSync('public/styles.css','utf8');
const handler=readFileSync('site-server/handler.js','utf8');
for(const needle of ["'/my-cinema'","[data-notebook-kind]",'notebookJSON(loadNotebook())','importNotebook(await file.text())','The Lumetra difference'.toUpperCase()]) assert(main.toUpperCase().includes(needle.toUpperCase()),needle);
for(const needle of ['.notebook-head','.notebook-stats','.launch-curation','prefers-reduced-motion']) assert(css.includes(needle));
for(const file of ['public/index.html','public/shell.html']) assert(readFileSync(file,'utf8').includes('href="/my-cinema"'));
assert(handler.includes('launchResearchEssays'));assert(handler.includes('/api/lookup'));
assert(readFileSync('site-server/catalogue.js','utf8').includes("genre=p.get('genre')"));
// This source-only test must also work in a fresh GitHub Actions checkout without a local SQLite snapshot.
console.log(`PASS launch readiness source contracts; ${deepResearchEssays.length + launchResearchEssays.length} deep essays, ${sources.size} unique cited source links, private notebook, linked UI`);
