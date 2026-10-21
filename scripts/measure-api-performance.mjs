import {performance} from 'node:perf_hooks';
import {writeFileSync,statSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {openCatalogue} from './local-catalogue.mjs';
import {api} from '../site-server/handler.js';
const {db,sqlite,assets}=openCatalogue('.sites-runtime/artwork-preview.sqlite');
const results=[];
for(const path of ['/api/stats','/api/films?q=moon&country=France&year=1902','/api/films/work-trip-to-the-moon','/api/programming?seed=release-review']){
 const times=[];let bytes=0;
 for(let n=0;n<10;n++){const start=performance.now();const response=await api(new Request('https://review.invalid'+path),{DB:db,ASSETS:assets});if(!response.ok)throw Error(path+' failed');const body=await response.arrayBuffer();bytes=body.byteLength;times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);results.push({path,runs:10,p50_ms:times[4],p95_ms:times[9],response_bytes:bytes});
}
const photos=readdirSync('public/photos').filter(x=>x.endsWith('-640.webp')).map(n=>({path:'/photos/'+n,bytes:statSync('public/photos/'+n).size}));
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(join(dir,f.name)):[join(dir,f.name)]);}
const scripts=files('dist/server').filter(p=>p.endsWith('.js')).map(p=>({path:p,raw_bytes:statSync(p).size,gzip_bytes:gzipSync(readFileSync(p)).length}));
writeFileSync('release/evidence/API_PERFORMANCE.json',JSON.stringify({scope:'In-process application API against local SQLite, warm repeated requests; excludes browser, network, Worker CPU/memory and mobile rendering',results,photo_640_sizes:photos,worker_js_modules:scripts},null,2));
console.log(JSON.stringify(results));sqlite.close();
