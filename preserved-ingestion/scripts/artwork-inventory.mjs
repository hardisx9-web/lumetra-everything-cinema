import pg from 'pg';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.chdir(resolve(import.meta.dirname,'../..'));
const c=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-artwork-readonly-inventory'});
const groups=new Map();
const bucket=provider=>{if(!groups.has(provider))groups.set(provider,{records_examined:0,image_references:0,works:new Set(),urls:new Set(),paths:new Set()});return groups.get(provider);};
function scan(value,path='',out=[]){if(!value||typeof value!=='object')return out;for(const [key,v] of Object.entries(value)){const here=path+'.'+key;if(typeof v==='string'&&/^https:\/\//.test(v)&&(/image|poster|thumbnail|thumb|jacket|photo|keyart|artwork/i.test(here)||/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(v))){try{const u=new URL(v);if(!u.username&&!u.password&&!/[?&](?:token|signature|key)=/i.test(v))out.push({url:v,path:here});}catch{}}else if(typeof v==='object')scan(v,here,out);}return out;}
try{
 await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tables={};
 for(const [table,sql] of [['work',"SELECT work_id,metadata->>'registry_source_id' provider,metadata payload FROM work"],['playback_source','SELECT work_id,registry_source_id provider,metadata payload FROM playback_source'],['ingest_candidate',"SELECT work_id,registry_source_id provider,jsonb_build_object('poster_url',poster_url,'original',candidate_json) payload FROM ingest_candidate"],['media_asset',"SELECT work_id,source_id provider,jsonb_build_object('image',canonical_url,'metadata',metadata) payload FROM media_asset"]]){
  const rows=(await c.query(sql)).rows;tables[table]=rows.length;
  for(const row of rows){const b=bucket(row.provider||'editorial');b.records_examined++;const refs=scan(row.payload);for(const r of refs){b.image_references++;b.urls.add(r.url);b.paths.add(r.path);if(row.work_id)b.works.add(row.work_id);}}
 }
 await c.query('COMMIT');
 const report={as_of:new Date().toISOString(),method:'Read-only recursive scan of every Work, playback metadata, immutable ingestion candidate and media_asset; no external image requests. References can include generic artwork and remain unapproved.',tables,providers:Object.fromEntries([...groups].map(([p,b])=>[p,{records_examined:b.records_examined,image_references:b.image_references,unique_image_urls:b.urls.size,works_with_image_opportunities:b.works.size,metadata_paths:[...b.paths].slice(0,40)}]))};
 await writeFile('docs/artwork-source-inventory.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await c.end();}
