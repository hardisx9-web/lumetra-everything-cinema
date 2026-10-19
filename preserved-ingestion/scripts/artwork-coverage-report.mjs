import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-artwork-report-v2'});
try{
 await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const baseline=JSON.parse(await readFile(resolve(root,'docs/artwork-coverage-baseline.json'),'utf8'));
 const map=JSON.parse(await readFile(resolve(root,'public/artwork.json'),'utf8'));
 const counts=(await c.query(`SELECT (SELECT count(*) FROM work)::integer films,(SELECT count(*) FROM playback_source)::integer playback_sources,(SELECT count(*) FROM public_watchable_sources)::integer eligible_sources,(SELECT count(DISTINCT work_id) FROM public_watchable_sources)::integer watchable_works,(SELECT count(*) FROM public_watchable_sources WHERE watch_state='WATCH_HERE')::integer embedded_sources`)).rows[0];
 const assets=(await c.query('SELECT work_id,asset_id,artwork_type,usage_basis,license_verified,review_status,health_status,license_url,match_confidence,image_width,image_height,source_id,duplicate_of FROM media_asset')).rows;
 const acceptable=a=>a.license_verified&&a.review_status==='APPROVED'&&a.health_status==='HEALTHY'&&a.license_url&&Number(a.match_confidence)>=.98&&a.image_width&&a.image_height;
 const usable=assets.filter(acceptable),works=new Set(usable.map(a=>a.work_id));
 const distinct=a=>new Set(a.map(r=>r.work_id)).size;
 const originalIds=new Set(['work-trip-to-the-moon','work-man-with-a-movie-camera','work-cleopatra-1917','work-london-after-midnight']);
 const newAssets=usable.filter(a=>!originalIds.has(a.work_id));
 const runs=(await c.query('SELECT run_id,mode,scope,status,started_at,finished_at,counts,checkpoint FROM artwork_enrichment_run ORDER BY started_at')).rows;
 const decisions=(await c.query('SELECT status,count(*)::integer decisions,count(DISTINCT work_id)::integer works FROM artwork_enrichment_item GROUP BY status')).rows;
 const candidates=(await c.query('SELECT decision,reason,count(*)::integer count FROM artwork_candidate GROUP BY decision,reason ORDER BY count DESC')).rows;
 const installedWrong=assets.filter(a=>a.review_status==='REJECTED_MATCH');
 const externalAttempts=(await c.query("SELECT count(*)::integer decisions,count(DISTINCT i.work_id)::integer unique_films FROM artwork_enrichment_item i JOIN artwork_enrichment_run r USING(run_id) WHERE r.mode<>'inventory' AND i.status<>'PENDING' ")).rows[0];
 const rejectedCandidates=(await c.query("SELECT count(*)::integer decisions,count(DISTINCT(work_id,source_page_url))::integer unique_work_candidate_pairs FROM artwork_candidate WHERE decision='REJECTED'")).rows[0];
 const health=(await c.query('SELECT status,count(*)::integer assets FROM artwork_health_check GROUP BY status')).rows;
 const report={generated_at:new Date().toISOString(),catalogue:counts,films_audited:counts.films,
  before:{usable_serving_works:baseline.serving_snapshot_coverage.films_with_reviewed_artwork,verified_archival_works:baseline.database_coverage.films_with_usable_artwork_total,posters:3,stills:1},
  after:{usable_works:works.size,serving_works:Object.keys(map).length,films_with_usable_poster:distinct(usable.filter(a=>a.artwork_type==='POSTER')),films_with_usable_still:distinct(usable.filter(a=>a.artwork_type==='STILL')),films_with_production_photograph:distinct(usable.filter(a=>a.artwork_type==='PRODUCTION_PHOTOGRAPH')),films_with_other_permitted_artwork:distinct(usable.filter(a=>!['POSTER','STILL','PRODUCTION_PHOTOGRAPH'].includes(a.artwork_type))),films_without_suitable_imagery:counts.films-works.size,films_with_unverified_rights:distinct(assets.filter(a=>!a.license_verified)),films_with_failed_image_url:distinct(assets.filter(a=>a.health_status==='FAILED')),films_with_access_blocked_image_url:distinct(assets.filter(a=>a.health_status==='BLOCKED')),image_rows_not_health_checked:assets.filter(a=>a.health_status==='UNTESTED').length,confirmed_incorrect_installed_artwork:installedWrong.length},
  increase:{new_works:works.size-originalIds.size,genuine_posters_added:distinct(newAssets.filter(a=>a.artwork_type==='POSTER')),valid_stills_added:distinct(newAssets.filter(a=>a.artwork_type==='STILL')),production_photographs_added:distinct(newAssets.filter(a=>a.artwork_type==='PRODUCTION_PHOTOGRAPH')),broken_images_repaired:0,duplicate_hash_records_detected:assets.filter(a=>a.duplicate_of).length},
  definitions:{coverage:'Distinct canonical Work IDs, not downloaded image count. Approved rights, high-confidence identity, successful full decode and local hosted variants required.',overlap:'Coverage types and unverified-rights counts can overlap on one Work; films_without_suitable_imagery is the complement of usable_works.',failed_urls:'Confirmed HTTP 404/410 only; access blocks and unchecked URLs are separate.',incorrect:'Rejected search candidates are NOT counted as incorrectly installed imagery. Historical institutional match accuracy remains unreviewed.',health:'250 inherited URLs were sampled in the prior attempt: HTTP/content-type availability only. Acquired published images additionally pass a complete image decode.',new_posters:'Newly pictured Works with posters; upgrades to four inherited files do not inflate additions.',remaining:'Without suitable imagery does not mean no image exists. Rights/matching/research remain unresolved.'},
  external_enrichment_attempts:externalAttempts,rejected_candidates:rejectedCandidates,withheld_edition_review:assets.filter(a=>a.review_status==='PENDING_EDITION_REVIEW').length,
  runs,decisions,candidate_decisions:candidates,existing_image_health_sample:health};
 await c.query('COMMIT');const text=JSON.stringify(report,null,2)+'\n';if(output)await writeFile(resolve(output),text);else console.log(text);
}finally{await c.end();}
