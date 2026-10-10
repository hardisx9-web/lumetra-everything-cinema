// Metadata-only remote health sample. Never treats accessible bytes as rights.
import pg from 'pg';
import {sleep} from '../lib/artwork/providers.mjs';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const n=Number(process.argv.find(a=>a.startsWith('--limit='))?.slice(8)||25);
if(!Number.isInteger(n)||n<1||n>250)throw Error('Use --limit=1..250');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-artwork-health-v2'}),last=new Map();
try{
 await c.connect();const rows=(await c.query("SELECT asset_id,canonical_url FROM media_asset WHERE health_status='UNTESTED' ORDER BY asset_id LIMIT $1",[n])).rows,counts={};
 for(const row of rows){let result;const host=new URL(row.canonical_url).hostname;await sleep(Math.max(0,(last.get(host)||0)+6500-Date.now()));last.set(host,Date.now());
 try{const response=await fetch(row.canonical_url,{method:'HEAD',headers:{'User-Agent':'LumetraArtworkHealth/2.0 (+https://lumetra-everything-cinema.ashiaslmm.chatgpt.site/about)'},signal:AbortSignal.timeout(15000)});const contentType=response.headers.get('content-type');result={status:response.ok&&contentType?.startsWith('image/')?'URL_AVAILABLE':[404,410].includes(response.status)?'FAILED':[401,403,429,503].includes(response.status)?'BLOCKED':'ERROR',http:response.status,type:contentType,error:null};await response.body?.cancel();}catch(e){result={status:'ERROR',error:e.name};}
 await c.query(`INSERT INTO artwork_health_check(asset_id,status,http_status,content_type,error_code,evidence) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(asset_id) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,content_type=excluded.content_type,error_code=excluded.error_code,evidence=excluded.evidence,attempts=artwork_health_check.attempts+1,checked_at=NOW()`,[row.asset_id,result.status,result.http||null,result.type||null,result.error||null,JSON.stringify({method:'HEAD',scope:'URL availability only; not full image decode or license validation'})]);
 await c.query('UPDATE media_asset SET health_status=$2,health_checked_at=NOW() WHERE asset_id=$1',[row.asset_id,result.status]);counts[result.status]=(counts[result.status]||0)+1;
 if(result.status==='BLOCKED'){console.log('Provider access/rate block: stopping sample.');break;}
 }
 console.log(JSON.stringify({counts}));
}finally{await c.end();}
