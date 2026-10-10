import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
const root=resolve(import.meta.dirname,'../..');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-artwork-export'});
const array=value=>Array.isArray(value)?[...new Set(value.flatMap(x=>typeof x==='string'?[x]:[]).filter(Boolean))]:[];
try{
 await client.connect();
 const rows=(await client.query(`SELECT a.*,w.canonical_title,w.year FROM media_asset a JOIN work w USING(work_id) WHERE a.license_verified AND a.review_status='APPROVED' AND a.health_status='HEALTHY' AND a.verification_timestamp IS NOT NULL AND a.license_url LIKE 'https://%' AND a.match_confidence>=0.98 ORDER BY a.work_id,a.is_primary DESC,a.verification_timestamp DESC`)).rows;
 const statements=[],map={};
 // Retract now-ineligible previously exported IDs without deleting review/history.
 const approved=new Set(rows.map(r=>r.asset_id));
 const withdrawn=(await client.query("SELECT asset_id FROM media_asset WHERE license_verified OR verification_timestamp IS NOT NULL")).rows.map(r=>r.asset_id).filter(id=>!approved.has(id));
 statements.push({sql:"UPDATE artwork_record SET review_status='WITHHELD' WHERE id IN (SELECT value FROM json_each(?))",values:[JSON.stringify(withdrawn)]});
 const columns=['id','entity_id','work_id','image_url','source_url','creator','license','attribution','verification_status','verified_at','width','height','artwork_type','provider','copyright_holder','license_url','match_confidence','match_method','review_status','health_status','health_checked_at','image_sha256','variants','artwork_language','territory','is_primary','original_url','alt','license_verified'];
 for(const r of rows){
  const m=r.metadata||{},url=m.hosted_url||m.published?.url,variants=m.variants||m.published?.variants||{};
  if(!url?.startsWith('/media/'))throw Error('Approved asset has no local hosted variant: '+r.asset_id);
  // Publication fails closed if any generated variant is absent, not just the original.
  for(const local of new Set([url,...Object.values(variants)]))await readFile(join(root,'public',local));
  const license=m.license||m.licence||r.usage_basis,alt=`${r.canonical_title}${r.year?' ('+r.year+')':''} — ${r.artwork_type==='POSTER'?'film poster':r.artwork_type==='PRODUCTION_PHOTOGRAPH'?'production photograph':'film still'}`;
  const record={id:r.asset_id,work_id:r.work_id,url,image_url:url,original_url:r.canonical_url,variants,source_page:r.source_page_url,provider:r.provider,creator:r.creator,license,license_url:r.license_url,attribution:r.attribution,artwork_type:r.artwork_type,review_status:r.review_status,health_status:r.health_status,verification_status:'VERIFIED',license_verified:true,rights_status:'REVIEWED_FILE_STATEMENT',match_confidence:Number(r.match_confidence),verified_at:new Date(r.verification_timestamp).toISOString(),width:r.image_width,height:r.image_height,alt,changes:m.changes||null,territory_note:m.territory_note||null};
  if(!map[r.work_id])map[r.work_id]=record;
  const values=[r.asset_id,r.work_id,r.work_id,url,r.source_page_url,r.creator,license,r.attribution,'VERIFIED',new Date(r.verification_timestamp).getTime(),r.image_width,r.image_height,r.artwork_type,r.provider,r.copyright_holder,r.license_url,Number(r.match_confidence),r.match_method,'APPROVED','HEALTHY',new Date(r.health_checked_at).getTime(),r.image_sha256,JSON.stringify(variants),r.artwork_language,r.territory,r.is_primary?1:0,r.canonical_url,alt,1];
  statements.push({sql:`INSERT INTO artwork_record(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c=>c!=='id').map(c=>c+'=excluded.'+c).join(',')}`,values});
 }
 // Only factual, already recorded metadata. No inferred nationality/language or synopsis.
 const works=(await client.query('SELECT work_id,year,director,metadata FROM work ORDER BY work_id')).rows;
 const languages=new Map();for(const r of (await client.query('SELECT work_id,audio_languages FROM playback_source WHERE work_id IS NOT NULL')).rows){languages.set(r.work_id,[...(languages.get(r.work_id)||[]),...array(r.audio_languages)]);}
 const metadata=works.map(w=>{const m=w.metadata||{},payload={display_title:m.displayTitle||m.display_title||null,languages:array([...(m.languages||[]),...(m.audio_languages||[]),...(languages.get(w.work_id)||[])]),genres:array(m.genre||m.genres),context:[w.year,w.director].filter(Boolean).join(' · ')};return [w.work_id,JSON.stringify(payload)];});
 for(let i=0;i<metadata.length;i+=40){const group=metadata.slice(i,i+40);statements.push({sql:`INSERT INTO work_metadata(work_id,payload) VALUES ${group.map(()=>'(?,?)').join(',')} ON CONFLICT(work_id) DO UPDATE SET payload=excluded.payload`,values:group.flat()});}
 // Add recorded display titles to the derived search index without editing Work metadata.
 statements.push({sql:"UPDATE search SET aliases=COALESCE((SELECT alternate_titles FROM work WHERE work.id=search.id),'[]')||' '||COALESCE((SELECT json_extract(payload,'$.display_title') FROM work_metadata WHERE work_id=search.id),'')",values:[]});
 // A version is a content digest, not a time stamp. Rerun exports are idempotent.
 const version=createHash('sha256').update(JSON.stringify(statements)).digest('hex').slice(0,16),paths=[];
 await mkdir(join(root,'public/publication/artwork'),{recursive:true});
 for(let i=0;i<statements.length;i+=30){const path='/publication/artwork/'+version+'-'+i/30+'.json';paths.push(path);await writeFile(join(root,'public',path),JSON.stringify(statements.slice(i,i+30))+'\n');}
 await writeFile(join(root,'public/artwork.json'),JSON.stringify(map,null,2)+'\n');
 await writeFile(join(root,'public/publication/artwork-manifest.json'),JSON.stringify({version,chunks:paths,assets:rows.length,works:Object.keys(map).length,metadata:metadata.length},null,2)+'\n');
 await writeFile(join(root,'site-server/artwork-version.js'),`// Generated by export-artwork-public.mjs; drives resumable versioned import.\nexport const artworkVersion = '${version}';\n`);
 console.log(JSON.stringify({version,works:Object.keys(map).length,assets:rows.length,metadata:metadata.length,chunks:paths.length}));
}catch(e){console.error('Artwork export: '+e.message);process.exitCode=1;}finally{await client.end().catch(()=>{});}
