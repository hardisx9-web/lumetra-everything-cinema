import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {learningData as data} from '../public/learning-data.js';
import {renderLearning} from '../public/cinema-learning.js';
import {posterMarkup} from '../public/artwork-ui.js';
const root = path.resolve('public');
const pages=[];
for(const base of ['/technology','/technology/cameras','/crew'])pages.push(base);
for(const group of data.technology){pages.push(`/technology/${group.id}`);for(const item of group.items)pages.push(`/technology/${group.id}/${item.slug}`);}
for(const group of data.crew){pages.push(`/crew/${group.id}`);for(const item of group.items)pages.push(`/crew/${group.id}/${item.slug}`);}
let bad=[];let imageReferences=0;
for(const url of pages){
 let el={innerHTML:'',querySelector(){return null;}};
 renderLearning(el,url,()=>{});
 const html=el.innerHTML;
 const srcs=[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(a=>a[1]);
 if(!srcs.length)bad.push(`${url} has no image`);
 for(const src of srcs){imageReferences++;
  if(src.startsWith('/visuals/')&&!existsSync(path.join(root,src)))bad.push(`${url} missing ${src}`);
 }
}
for(let i=0;i<1000;i++){
 const film={id:`catalogue-work-${i}`,title:`Film ${i}`,year:1930+i%90,director:'Recorded filmmaker',countries:['India']};
 const html=posterMarkup(film);
 if(!html.includes('<img')||!html.includes('not a historical poster'))bad.push('film card fallback: '+i);
}
for(let i=0;i<12;i++)assert.ok(existsSync(path.join(root,`/visuals/people-scenes/${String(i).padStart(2,'0')}.svg`)));
for(let i=0;i<16;i++)assert.ok(existsSync(path.join(root,`/visuals/essay-scenes/${String(i).padStart(2,'0')}.svg`)));
const report={tested_routes:pages.length,technology_entries:data.technology.reduce((n,x)=>n+x.items.length,0),crew_entries:data.crew.reduce((n,x)=>n+x.items.length,0),image_references:imageReferences,film_fallbacks_sampled:1000,missing:bad,valid:bad.length===0};
console.log(JSON.stringify(report,null,2));
assert.deepEqual(bad,[]);
