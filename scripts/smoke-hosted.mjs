import assert from 'node:assert/strict';
const base='http://127.0.0.1:4188';
for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
for(let n=0;n<150;n++){const r=await fetch(base+'/api/initialize',{method:'POST'});const j=await r.json();assert(r.ok,JSON.stringify(j));if(j.ready)break;assert(n<149);}
const stats=await fetch(base+'/api/stats').then(r=>r.json());assert.equal(stats.works,20512);assert.equal(stats.eligible_sources,3883);
const search=await fetch(base+'/api/films?q=moon').then(r=>r.json());assert.equal(search.total,27);
assert.equal((await fetch(base+'/film/'+search.items[0].id)).status,200);
const media=await fetch(base+'/media/opening.mp4',{headers:{Range:'bytes=0-1023'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,1024);
const missing=await fetch(base+'/missing.png');assert.equal(missing.status,404);
console.log(JSON.stringify({pass:true,stats,search:search.total,range:media.status}));
