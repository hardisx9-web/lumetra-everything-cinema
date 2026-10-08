import { writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required; reports count database observations, not generated marketing numbers.'); process.exit(2); }
const runOption=process.argv.find((arg)=>arg.startsWith('--run='))?.slice(6);
const output=process.argv.find((arg)=>arg.startsWith('--output='))?.slice(9);
const client=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'global-cinema-catalogue-report'});
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const run=(await client.query(runOption?'SELECT * FROM ingest_run WHERE run_id=$1':'SELECT * FROM ingest_run WHERE store_version=1 ORDER BY started_at DESC LIMIT 1',runOption?[runOption]:[])).rows[0];
  if(!run) throw new Error('No source-specific PostgreSQL sweep has been persisted');
  const targets=[...(run.registry_snapshot?.sources||[]),...(run.registry_snapshot?.rights_holder_channels_to_enumerate||[])];
  const sourceResults=[];
  for(const source of targets) {
    const group=(await client.query('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2',[run.run_id,source.id])).rows[0];
    const row=(await client.query(`SELECT COUNT(*)::integer AS candidates_discovered,COUNT(DISTINCT c.work_id)::integer AS unique_films,
      COUNT(*) FILTER (WHERE c.work_id IS NULL)::integer AS identity_unresolved,
      COUNT(v.verification_id)::integer AS verification_attempted,
      COUNT(*) FILTER (WHERE v.full_film_verified AND v.verifier='provider-health-check')::integer AS full_films_verified,
      COUNT(*) FILTER (WHERE v.free_verified AND v.verifier='provider-health-check')::integer AS free_verified,
      COUNT(*) FILTER (WHERE live.watch_state='WATCH_HERE')::integer AS watch_here,
      COUNT(*) FILTER (WHERE live.watch_state='WATCH_FREE_EXTERNALLY')::integer AS watch_free_externally,
      COUNT(DISTINCT live.work_id)::integer AS verified_free_unique_films,
      COUNT(*) FILTER (WHERE v.verification_id IS NULL)::integer AS verification_pending,
      COUNT(*) FILTER (WHERE v.record_json->>'lifecycle_status'='REJECTED')::integer AS rejected,
      COUNT(*) FILTER (WHERE v.record_json->>'lifecycle_status'='EXPIRED' OR v.live_check_status='FAIL')::integer AS unavailable,
      COUNT(*) FILTER (WHERE v.verification_id IS NOT NULL AND live.source_id IS NULL AND COALESCE(v.record_json->>'lifecycle_status','') NOT IN ('EXPIRED','REJECTED'))::integer AS pending_review,
      COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(v.record_json->'territories','[]'::jsonb)) > 0 AND LOWER(v.record_json->'territories'->>0) NOT IN ('worldwide','todo el mundo'))::integer AS region_restricted,
      MAX(v.checked_at) AS last_checked,
      COUNT(*) FILTER (WHERE c.work_id IS NOT NULL)::integer-COUNT(DISTINCT c.work_id)::integer AS within_source_duplicates_merged
      FROM ingest_candidate c LEFT JOIN source_verification v ON v.candidate_id=c.candidate_id AND v.ingest_run_id=c.ingest_run_id
      LEFT JOIN public_watchable_sources live ON live.source_id=v.source_id
      WHERE c.ingest_run_id=$1 AND c.registry_source_id=$2`,[run.run_id,source.id])).rows[0];
    const errors=(await client.query(`SELECT COALESCE(v.error_code,'UNSPECIFIED') AS code,COUNT(*)::integer AS count
      FROM source_verification v JOIN ingest_candidate c ON c.candidate_id=v.candidate_id
      WHERE c.ingest_run_id=$1 AND c.registry_source_id=$2 AND v.error_code IS NOT NULL GROUP BY 1 ORDER BY count DESC,code`,[run.run_id,source.id])).rows;
    sourceResults.push({source:source.name,registry_source_id:source.id,priority:source.priority,...row,
      status:group?.status||'NOT_ENUMERATED',enumeration_status:group?.enumeration_status||'NOT_ENUMERATED',enumeration_complete:group?.enumeration_complete||false,
      verification_complete:Boolean(group?.enumeration_complete && row.verification_attempted===row.candidates_discovered && row.pending_review===0),
      advertised_total:group?.result_json?.advertised_total??null,pages:group?.result_json?.pages??null,
      blocker:group?.blocker||null,access_required:group?.result_json?.access_required||null,errors,
      last_checked:row.last_checked||group?.result_json?.checked_at||null});
  }
  const identities=(await client.query(`SELECT COUNT(DISTINCT work_id)::integer AS unique_films,COUNT(*) FILTER(WHERE work_id IS NULL)::integer AS identity_unresolved,
    COUNT(*) FILTER(WHERE work_id IS NOT NULL)::integer-COUNT(DISTINCT work_id)::integer AS duplicates_merged FROM ingest_candidate WHERE ingest_run_id=$1`,[run.run_id])).rows[0];
  const databaseTotals=(await client.query(`SELECT (SELECT COUNT(*)::integer FROM work) AS works,(SELECT COUNT(*)::integer FROM playback_source) AS playback_sources,
    (SELECT COUNT(*)::integer FROM source_verification) AS evidence_rows,(SELECT COUNT(*)::integer FROM ingest_candidate) AS historical_and_current_candidates,
    (SELECT COUNT(DISTINCT work_id)::integer FROM public_watchable_sources) AS currently_watchable_works,(SELECT COUNT(*)::integer FROM public_watchable_sources) AS currently_watchable_sources,
    (SELECT COUNT(*)::integer FROM public_watchable_sources WHERE watch_state='WATCH_HERE') AS watch_here_sources,
    (SELECT COUNT(DISTINCT work_id)::integer FROM public_watchable_sources WHERE watch_state='WATCH_HERE') AS watch_here_unique_films,
    (SELECT COUNT(*)::integer FROM public_watchable_sources WHERE watch_state='WATCH_FREE_EXTERNALLY') AS watch_free_externally_sources,
    (SELECT COUNT(DISTINCT work_id)::integer FROM public_watchable_sources WHERE watch_state='WATCH_FREE_EXTERNALLY') AS watch_free_externally_unique_films`)).rows[0];
  const totals={registered_sources:targets.length,enumerated_sources:sourceResults.filter((row)=>row.enumeration_complete).length,
    unfinished_sources:sourceResults.filter((row)=>!row.enumeration_complete).length,...identities};
  for(const key of ['candidates_discovered','verification_attempted','full_films_verified','free_verified','watch_here','watch_free_externally','rejected','unavailable','pending_review','region_restricted']) totals[key]=sourceResults.reduce((sum,row)=>sum+row[key],0);
  totals.public_watchable_sources=totals.watch_here+totals.watch_free_externally;
  const report={generated_at:new Date().toISOString(),counts_source:'PostgreSQL',run_id:run.run_id,run_status:run.status,
    started_at:run.started_at,finished_at:run.finished_at,enumeration_complete:totals.unfinished_sources===0,
    catalogue_task_complete:totals.unfinished_sources===0 && sourceResults.every((source)=>source.verification_complete),
    count_definitions:{candidates_discovered:'Distinct official source URLs retained for this run; not a claim all are full films.',unique_films:'Resolved canonical Work IDs; unresolved identities are counted separately.',
      duplicates_merged:'Resolved candidate associations minus distinct canonical Works; no title-only grouping.',watch_here:'Current database eligibility view, with independently checked working embed and permission.',
      watch_free_externally:'Current database eligibility view, external viewing only.',full_films_verified:'Title-specific classification/runtime evidence; free/live checks remain separate.',
      verified_free_unique_films:'Distinct canonical Works in the current independent full/free/official/live eligibility view.',verification_pending:'Discovered candidates without a persisted verification attempt.',
      region_restricted:'Known title-level restrictions; unknown territory is not called worldwide.',verification_complete:'All catalogue candidates processed with no pending playback/identity review. Rejected and expired records never watchable.'},
    source_results:sourceResults,global_totals:totals,database_totals:databaseTotals};
  await client.query('COMMIT');
  const text=`${JSON.stringify(report,null,2)}\n`;
  if(output){const destination=resolve(output);const temporary=`${destination}.${process.pid}.tmp`;await writeFile(temporary,text);await rename(temporary,destination);console.log(JSON.stringify({output,run_id:run.run_id,...totals,catalogue_task_complete:report.catalogue_task_complete}));}
  else process.stdout.write(text);
} catch(error){await client.query('ROLLBACK').catch(()=>{});console.error(`Catalogue report failed: ${error.message}`);process.exitCode=1;}
finally {await client.end().catch(()=>{});}
