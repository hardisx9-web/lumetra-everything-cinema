import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {learningData as d} from '../public/learning-data.js';
import {renderLearning} from '../public/cinema-learning.js';
const routes=['/technology','/technology/cameras','/crew'];
for(const [type,groups] of [['technology',d.technology],['crew',d.crew]])for(const g of groups){routes.push(`/${type}/${g.id}`);for(const i of g.items)routes.push(`/${type}/${g.id}/${i.slug}`);}
const results=[];
for(const route of new Set(routes)) {
 const stub={textContent:'',addEventListener(){}};
 const main={innerHTML:'',querySelector(s){return s==='#crew-search-status'?stub:null;}};
 renderLearning(main,route,()=>{});
 assert.doesNotMatch(main.innerHTML,/Entry not found|\/visuals\/|<svg/);
 assert.match(main.innerHTML,/<h1>/);
 const count=(main.innerHTML.match(/data-image-status="PENDING"/g)||[]).length;
 results.push({route,pending_slots:count,rendered_html_bytes:Buffer.byteLength(main.innerHTML)});
}
mkdirSync('release-audit',{recursive:true});
writeFileSync('release-audit/learning-render.json',JSON.stringify({scope:'HTML generation only, not browser layout/network/interaction testing',routes:results},null,2));
console.log(`${results.length} learning routes rendered without rejected illustrations. Pending images remain release blockers.`);
