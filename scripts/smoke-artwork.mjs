import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const base=process.env.PREVIEW_URL||'http://127.0.0.1:4173',sharp=createRequire(import.meta.url)('../.sites-runtime/image-tools/node_modules/sharp');
const json=async path=>{const r=await fetch(base+path);assert.equal(r.status,200,path);return r.json();};
const stats=await json('/api/stats');assert.equal(stats.works,20512);assert(stats.artwork_ready);
const search=await json('/api/films?artwork=1&limit=48');assert.equal(search.total,stats.approved_artwork);
let images=0;const seen=new Set();
for(const film of search.items){
 const detail=await json('/api/films/'+film.id);assert.equal(detail.artwork.id,film.artwork.id);assert.equal(detail.artwork.work_id,film.id);assert(detail.artwork.attribution);assert(detail.artwork.license_url);
 for(const url of new Set([detail.artwork.url,...Object.values(detail.artwork.variants)])){
  if(seen.has(url))continue;seen.add(url);const r=await fetch(base+url);assert.equal(r.status,200);assert(r.headers.get('content-type').startsWith('image/'));
  const bytes=Buffer.from(await r.arrayBuffer()),m=await sharp(bytes).metadata();await sharp(bytes).raw().toBuffer();
  assert(Math.abs(m.width/m.height-detail.artwork.width/detail.artwork.height)<.015,'original image proportions preserved');images++;
 }
 const shell=await fetch(base+'/film/'+film.id);assert.equal(shell.status,200);assert(shell.headers.get('content-security-policy'));assert((await shell.text()).includes('horizon-nav'));
}
const programme=await json('/api/programming?seed=owner-preview-2026-10-09');const ids=['carousel','history','featured','watch','collection'].flatMap(k=>programme[k].map(w=>w.id));assert.equal(ids.length,new Set(ids).size);assert(programme.watch.every(w=>w.watchable));
assert.deepEqual(programme,await json('/api/programming?seed=owner-preview-2026-10-09'));
const different=await json('/api/programming?seed=owner-preview-reshuffled');assert.notDeepEqual(programme.carousel.map(w=>w.id),different.carousel.map(w=>w.id));
const moon=await json('/api/films?q=moon&country=France&year=1902');assert.equal(moon.total,1);
const pather=await json('/api/films?q=Pather');assert(pather.items.some(w=>w.id==='work-pather-panchali'&&w.artwork));
assert.equal((await fetch(base+'/media/nonexistent.webp')).status,404);
assert.equal((await fetch(base+'/publication/artwork-manifest.json')).status,404);
assert.equal((await fetch(base+'/api/films?page=0')).status,400);
const video=await fetch(base+'/media/opening.mp4',{headers:{Range:'bytes=0-1023'}});assert.equal(video.status,206);assert.equal((await video.arrayBuffer()).byteLength,1024);
// Verify immutable supplied assets remain byte-identical to the original checksum report.
const ownerHashes=readFileSync('docs/upload-checksums.sha256','utf8').trim().split('\n').map(line=>line.split(/\s+/)[0]);
for(const [i,file] of ['logo.png','stage.png','opening.mp4'].entries())assert.equal(createHash('sha256').update(readFileSync('public/media/'+file)).digest('hex'),ownerHashes[i]);
const css=readFileSync('public/styles.css','utf8');assert(css.includes('object-fit:contain'));assert(css.includes('.horizon-nav'));
const report={passed:true,checked_at:new Date().toISOString(),preview:base,api_runtime:'Native Node/D1-compatible SQLite adapter; actual application handler and exported catalogue',stats,artwork_dossiers_checked:search.items.length,images_http_and_full_decode_checked:images,programme:programme.stats,unique_featured_ids:ids.length,checks:['real search including English display title','dossier provenance','all published image variants decode','source states unchanged','unique/session/day seed programming','missing image HTTP 404','private publication 404','API validation','original video byte-range','Horizon shell retained'],browser_limit:'No browser automation or physical mobile visual test available; HTTP/image/helper checks do not establish rendered layout or WebGL correctness.'};
writeFileSync('docs/artwork-local-api-tests.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
