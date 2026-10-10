import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import pg from 'pg';
import {matchArtwork,plain,normalize,rights} from '../lib/artwork/policy.mjs';
import {commonsSearch,commonsFiles,locSearch,europeanaSearch,request,digest} from '../lib/artwork/providers.mjs';
const root=resolve(import.meta.dirname,'../..');
const arg=(key,fallback)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.split('=').slice(1).join('=')||fallback;
const mode=arg('mode','commons'),limit=Number(arg('limit','25')),resume=arg('run',null),focus=arg('focus','catalogue');
if(!['catalogue','history'].includes(focus))throw Error('Use --focus=catalogue|history');
if(mode==='europeana'&&!process.env.EUROPEANA_API_KEY)throw Error('EUROPEANA_KEY_REQUIRED');
const scope='v2-frozen-cohort'+(focus==='history'?':history':'');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
if(!['commons','reviewed','loc','europeana'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Use --mode=commons|reviewed|loc|europeana --limit=1..1000');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-artwork-v2'});
const sharp=createRequire(import.meta.url)(process.env.ARTWORK_SHARP_MODULE||join(root,'.sites-runtime/image-tools/node_modules/sharp'));
let run,stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
const reviewed=JSON.parse(await readFile(join(root,'catalogue-editorial/artwork-reviewed.json'),'utf8'));
async function storeImage(work,page,decision){
 const info=page.imageinfo[0],meta=info.extmetadata,permission=decision.permission;
 const bytes=await request(info.url,{binary:true,client}),hash=digest(bytes);
 const dimensions=await sharp(bytes).metadata();if(!dimensions.width||!dimensions.height||dimensions.width<180||dimensions.height<180)throw Error('INVALID_IMAGE_DIMENSIONS');
 // Decode the complete image, not just its header; no empty/truncated download passes.
 await sharp(bytes).resize({width:16,height:16,fit:'inside'}).raw().toBuffer();
 const duplicate=(await client.query(`SELECT asset_id,work_id FROM media_asset WHERE image_sha256=$1 AND work_id<>$2 AND review_status='APPROVED'`,[hash,work.work_id])).rows[0];
 if(duplicate)throw Error('DUPLICATE_IMAGE_OTHER_WORK:'+duplicate.work_id);
 const base=`/media/artwork/${hash.slice(0,24)}`,variants={};await mkdir(join(root,'public/media/artwork'),{recursive:true});
 for(const width of [320,640,960]){const actual=Math.min(width,dimensions.width);const url=base+'-'+actual+'.webp';await sharp(bytes).rotate().resize({width:actual,withoutEnlargement:true}).webp({quality:84}).toFile(join(root,'public',url));variants[actual]=url;}
 const artist=plain(meta.Artist)||'Creator not recorded',attribution=plain(meta.Attribution)||artist;
 const metadata={file_title:page.title,original_url:info.url,hosted_url:variants[Math.min(640,dimensions.width)],variants,license:permission.name,license_url:permission.url,license_statement:permission.statement,source_page:info.descriptionurl,commons_metadata:meta,match_evidence:decision.evidence,changes:'Proportional resize and WebP encoding; no crop',territory_note:'Public-domain status can vary by jurisdiction; see original file rights statement.'};
 await client.query('BEGIN');try{
 const asset=(await client.query(`INSERT INTO media_asset(work_id,asset_type,artwork_type,canonical_url,usage_basis,license_verified,attribution,source_id,metadata,source_page_url,provider,creator,license_url,match_confidence,match_method,match_status,review_status,image_width,image_height,image_sha256,health_status,health_checked_at,verification_timestamp,is_primary)
 VALUES($1,$2,$2,$3,$4,TRUE,$5,'WIKIMEDIA_COMMONS',$6::jsonb,$7,'Wikimedia Commons',$8,$9,$10,$11,'VERIFIED','APPROVED',$12,$13,$14,'HEALTHY',NOW(),NOW(),FALSE)
 ON CONFLICT(work_id,asset_type,canonical_url) DO UPDATE SET artwork_type=EXCLUDED.artwork_type,metadata=EXCLUDED.metadata,source_page_url=EXCLUDED.source_page_url,provider=EXCLUDED.provider,creator=EXCLUDED.creator,license_url=EXCLUDED.license_url,match_confidence=EXCLUDED.match_confidence,match_method=EXCLUDED.match_method,match_status='VERIFIED',review_status='APPROVED',image_width=EXCLUDED.image_width,image_height=EXCLUDED.image_height,image_sha256=EXCLUDED.image_sha256,health_status='HEALTHY',health_checked_at=NOW(),verification_timestamp=NOW() RETURNING asset_id`,[work.work_id,decision.type,info.url,permission.basis,attribution,JSON.stringify(metadata),info.descriptionurl,artist,permission.url,decision.confidence,decision.reason,dimensions.width,dimensions.height,hash])).rows[0];
 await client.query(`UPDATE media_asset SET duplicate_of=(SELECT asset_id FROM media_asset WHERE work_id=$2 AND image_sha256=$3 AND asset_id<>$1 ORDER BY created_at,asset_id LIMIT 1) WHERE asset_id=$1`,[asset.asset_id,work.work_id,hash]);
 await client.query('UPDATE media_asset SET is_primary=FALSE WHERE work_id=$1 AND is_primary',[work.work_id]);
 await client.query(`UPDATE media_asset SET is_primary=TRUE WHERE asset_id=(SELECT asset_id FROM media_asset WHERE work_id=$1 AND review_status='APPROVED' AND health_status='HEALTHY' ORDER BY (artwork_type='POSTER') DESC,image_width*image_height DESC LIMIT 1)`,[work.work_id]);
 await client.query('COMMIT');return asset.asset_id;
 }catch(e){await client.query('ROLLBACK');throw e;}
}
async function decide(work){
 if(mode==='loc'||mode==='europeana'){
  const rows=await (mode==='loc'?locSearch:europeanaSearch)(work,client);
  return {status:rows.length?'REVIEW':'NO_MATCH',reason:'INSTITUTIONAL_ITEM_RIGHTS_AND_MATCH_REVIEW_REQUIRED',payload:{items:rows}};
 }
 const review=reviewed.find(r=>r.work_id===work.work_id);
 if(mode==='reviewed'&&(!review||review.status==='HOLD'||normalize(review.title)!==normalize(work.canonical_title)||review.year!==work.year||normalize(review.director)!==normalize(work.director)))throw Error('REVIEWED_MAPPING_DRIFT_OR_HOLD');
 const pages=mode==='reviewed'?await commonsFiles([review.file],client):await commonsSearch(work,client);
 const evaluated=pages.map(page=>{
  let decision=matchArtwork(work,page);
  const hold=reviewed.find(r=>r.status==='HOLD'&&normalize(page.title.replace(/^File:/,''))===normalize(r.file));
  if(hold)decision={accepted:false,reason:'REVIEWED_EDITION_OR_RIGHTS_HOLD'};
  if(!hold&&mode==='reviewed'&&review && normalize(review.title)===normalize(work.canonical_title)&&review.year===work.year&&normalize(review.director)===normalize(work.director)){
   const info=page.imageinfo?.[0],permission=rights(info?.extmetadata);
   // Explicit reviewed file mapping is additional identity evidence, NOT a license override.
   if(info&&permission&&normalize(page.title.replace(/^File:/,''))===normalize(review.file))decision={accepted:true,type:review.type,permission,reason:'REVIEWED_EXACT_WORK_FILE',confidence:1,evidence:{...review,source_description:plain(info.extmetadata.ImageDescription)}};
  }
  return {page,decision};
 });
 // Distinct catalogue Works sharing a title/year are not auto-merged.
 const twins=(await client.query('SELECT work_id,director FROM work WHERE lower(canonical_title)=lower($1) AND year=$2 AND work_id<>$3',[work.canonical_title,work.year,work.work_id])).rows;
 if(twins.length&&mode!=='reviewed')for(const e of evaluated)e.decision={...e.decision,accepted:false,reason:'AMBIGUOUS_CATALOGUE_TITLE_YEAR'};
 for(const {page,decision} of evaluated)await client.query(`INSERT INTO artwork_candidate(candidate_key,run_id,work_id,provider,source_page_url,decision,reason,evidence) VALUES($1,$2,$3,'Wikimedia Commons',$4,$5,$6,$7::jsonb) ON CONFLICT(candidate_key) DO NOTHING`,[digest(run.run_id+work.work_id+page.title),run.run_id,work.work_id,page.imageinfo?.[0]?.descriptionurl||'https://commons.wikimedia.org/wiki/'+encodeURIComponent(page.title),decision.accepted?'MATCHED':'REJECTED',decision.reason,JSON.stringify({decision,page})]);
 const suitable=evaluated.filter(e=>e.decision.accepted).sort((a,b)=>(b.decision.type==='POSTER')-(a.decision.type==='POSTER')||b.page.imageinfo[0].width-a.page.imageinfo[0].width);
 if(!suitable.length)return {status:pages.length?'REJECTED':'NO_MATCH',reason:pages.length?'NO_VERIFIED_FILM_ARTWORK':'NO_PROVIDER_RESULT',payload:{candidates:pages.length}};
 const chosen=suitable[0],asset_id=await storeImage(work,chosen.page,chosen.decision);
 return {status:'ACCEPTED',asset_id,reason:chosen.decision.reason,payload:{type:chosen.decision.type,source_page:chosen.page.imageinfo[0].descriptionurl,candidates:pages.length}};
}
try{
 await client.connect();
 if(!(await client.query("SELECT pg_try_advisory_lock(hashtext('lumetra-artwork-v2')) locked")).rows[0].locked)throw Error('ANOTHER_ARTWORK_RUN_IS_ACTIVE');
 if(resume)run=(await client.query('SELECT * FROM artwork_enrichment_run WHERE run_id=$1',[resume])).rows[0];
 else if(!process.argv.includes('--new-run'))run=(await client.query("SELECT * FROM artwork_enrichment_run WHERE mode=$1 AND scope=$2 AND status IN ('RUNNING','PAUSED') ORDER BY started_at DESC LIMIT 1",[mode,scope])).rows[0];
 if(resume&&!run)throw Error('RESUME_RUN_NOT_FOUND');
 if(run&&run.mode!==mode)throw Error('RESUME_MODE_MISMATCH');
 if(!run){
  await client.query('BEGIN');
  run=(await client.query("INSERT INTO artwork_enrichment_run(mode,scope,batch_size) VALUES($1,$2,$3) RETURNING *",[mode,scope,limit])).rows[0];
  const works=(await client.query(`SELECT w.* FROM work w ${mode==='reviewed'?'WHERE work_id=ANY($1::text[])':"WHERE NOT EXISTS(SELECT 1 FROM media_asset a WHERE a.work_id=w.work_id AND a.review_status='APPROVED' AND a.health_status='HEALTHY')"} ${focus==='history'?"AND w.year<1931 AND w.director ~* 'Dreyer|Christensen|Sjöström|Stiller|Gad|Blom|Bauer|Kuleshov|Кулеш|Пудов|Эйзен|Довжен|Barnet|Барнет'":''} ORDER BY CASE WHEN w.work_id LIKE 'work-%' THEN 0 WHEN EXISTS(SELECT 1 FROM public_watchable_sources p WHERE p.work_id=w.work_id) THEN 10 WHEN w.year<1931 THEN 20 ELSE 100 END,w.year NULLS LAST,w.work_id`,mode==='reviewed'?[reviewed.filter(r=>r.status!=='HOLD').map(r=>r.work_id)]:[])).rows;
  try{for(let i=0;i<works.length;i++)await client.query("INSERT INTO artwork_enrichment_item(run_id,work_id,status,priority,input_snapshot) VALUES($1,$2,'PENDING',$3,$4::jsonb)",[run.run_id,works[i].work_id,i,JSON.stringify({work_id:works[i].work_id,canonical_title:works[i].canonical_title,original_title:works[i].original_title,alternate_titles:works[i].alternate_titles,year:works[i].year,director:works[i].director,countries:works[i].countries,metadata:{displayTitle:works[i].metadata?.displayTitle,display_title:works[i].metadata?.display_title}})]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 }
 console.log(JSON.stringify({run_id:run.run_id,mode,resume:!!resume,limit}));
 if(run.status==='COMPLETED'){console.log('Completed run preserved; use --new-run for new observations.');}
 else{
 const items=(await client.query("SELECT * FROM artwork_enrichment_item WHERE run_id=$1 AND status='PENDING' ORDER BY priority LIMIT $2",[run.run_id,limit])).rows;
 await client.query("UPDATE artwork_enrichment_run SET status='RUNNING' WHERE run_id=$1",[run.run_id]);
 for(const item of items){if(stopping)break;let result;try{
 const existing=mode!=='reviewed'?(await client.query("SELECT asset_id FROM media_asset WHERE work_id=$1 AND license_verified AND license_url IS NOT NULL AND review_status='APPROVED' AND health_status='HEALTHY' LIMIT 1",[item.work_id])).rows[0]:null;
 result=existing?{status:'ALREADY_COVERED',asset_id:existing.asset_id,reason:'REUSED_EXISTING_VERIFIED_ARTWORK'}:await decide(item.input_snapshot);
 }catch(e){if(e.pause){console.log(JSON.stringify({paused:e.message,until:e.until||null}));break;}result={status:'FAILED',reason:e.message};}
 await client.query('UPDATE artwork_enrichment_item SET status=$3,reason=$4,asset_id=$5,provider=$6,payload=$7::jsonb,attempts=attempts+1,checked_at=NOW() WHERE run_id=$1 AND work_id=$2',[run.run_id,item.work_id,result.status,result.reason,result.asset_id||null,mode,JSON.stringify(result.payload||{})]);console.log(JSON.stringify({work_id:item.work_id,...result,payload:undefined}));
 }
 const counts=Object.fromEntries((await client.query('SELECT status,count(*)::integer n FROM artwork_enrichment_item WHERE run_id=$1 GROUP BY status',[run.run_id])).rows.map(r=>[r.status,r.n]));
 const status=counts.PENDING?'PAUSED':'COMPLETED';await client.query('UPDATE artwork_enrichment_run SET status=$2,counts=$3::jsonb,checkpoint=$3::jsonb,finished_at=CASE WHEN $2=\'COMPLETED\' THEN NOW() ELSE NULL END WHERE run_id=$1',[run.run_id,status,JSON.stringify(counts)]);
 console.log(JSON.stringify({run_id:run.run_id,status,counts}));
 }
}catch(e){console.error('Artwork enrichment: '+e.message);process.exitCode=1;}finally{await client.end().catch(()=>{});}
