import pg from 'pg';
import { inspectProvider } from '../db/provider-health.mjs';
import { SourceHttp } from '../lib/ingestion/http.mjs';
import { resolveWork } from '../db/entity-resolution.mjs';
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required.');process.exit(2);}
const dryRun=process.argv.includes('--dry-run');
const arg=process.argv.find((arg)=>arg.startsWith('--limit='));
const limit=arg?Number(arg.slice(8)):null;
if(limit!==null&&(!Number.isSafeInteger(limit)||limit<1)){console.error('--limit must be a positive diagnostic limit; default checks all eligible sources.');process.exit(2);}
const client=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'global-cinema-health'});
try {
  await client.connect();
  const rows=(await client.query(`SELECT p.*,r.source_json AS registry_json FROM playback_source p JOIN source_registry r ON r.source_id=p.registry_source_id
    WHERE (p.full_film_verified AND p.free_verified AND p.official_or_rights_verified) OR p.lifecycle_status IN ('VERIFIED','PUBLISHED')
    ORDER BY p.registry_source_id,p.source_id${limit===null?'':' LIMIT $1'}`,limit===null?[]:[limit])).rows;
  const httpBySource=new Map(),results=[];
  for(const source of rows){
    if(!httpBySource.has(source.registry_source_id))httpBySource.set(source.registry_source_id,new SourceHttp());
    const check=await inspectProvider(source,undefined,new Date(),httpBySource.get(source.registry_source_id));
    const record=check.record;const checkedAt=new Date();
    let allowed=check.status==='PASS'&&record?.full_film_verified&&record?.free_verified&&record?.official_or_rights_verified&&source.work_id;
    let identity={workId:source.work_id,review:source.match_review};
    if(!dryRun)await client.query('BEGIN');
    try{
      if(!dryRun&&record)identity=await resolveWork(client,record);
      allowed=Boolean(allowed&&!identity.review&&identity.workId===source.work_id);
      const watch=allowed?(record.embed_status==='PERMITTED'&&record.embed_working&&record.embed_url_if_allowed?'WATCH_HERE':'WATCH_FREE_EXTERNALLY'):'NO_VERIFIED_FREE_STREAM';
      const lifecycle=allowed?'VERIFIED':check.status==='FAIL'?'EXPIRED':'REVIEW';
      results.push({source_id:source.source_id,status:check.status,reason:check.reason,watch_state:watch,identity_review:identity.review});
      if(dryRun)continue;
      await client.query(`INSERT INTO source_health_check (source_id,checked_at,http_status,live_check_status,response_url,error_code,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [source.source_id,checkedAt,check.httpStatus,check.status,source.canonical_source_url,check.reason,JSON.stringify(check.evidence)]);
      await client.query(`INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,http_status,evidence,error_code,verifier,embed_working,availability_expiry)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'provider-health-check',$12,$13)`,
        [source.source_id,checkedAt,Boolean(record?.full_film_verified),Boolean(record?.free_verified),Boolean(record?.official_or_rights_verified),check.status,record?.embed_status||source.embed_status,watch,check.httpStatus,JSON.stringify(check.evidence),allowed?null:check.reason,Boolean(allowed&&record?.embed_working),record?.availability_expiry_if_known||source.availability_expiry_if_known]);
      await client.query(`UPDATE playback_source SET full_film_verified=$2,free_verified=$3,official_or_rights_verified=$4,
        live_check_status=$5,watch_state=$6,lifecycle_status=$7,last_checked_at=$8,verification_evidence=$9::jsonb,
        embed_status=$10,embed_working=$11,embed_url_if_allowed=$12,availability_expiry_if_known=$13,match_review=$14,updated_at=NOW() WHERE source_id=$1`,
        [source.source_id,Boolean(record?.full_film_verified),Boolean(record?.free_verified),Boolean(record?.official_or_rights_verified),check.status,watch,lifecycle,checkedAt,JSON.stringify(check.evidence),record?.embed_status||source.embed_status,Boolean(allowed&&record?.embed_working),allowed?record.embed_url_if_allowed:null,record?.availability_expiry_if_known||source.availability_expiry_if_known,identity.review||null]);
      await client.query('COMMIT');
    }catch(error){if(!dryRun)await client.query('ROLLBACK');throw error;}
  }
  console.log(JSON.stringify({checked:results.length,dry_run:dryRun,diagnostic_limit:limit,passed:results.filter((x)=>x.status==='PASS').length,pending:results.filter((x)=>x.status==='PENDING').length,failed:results.filter((x)=>x.status==='FAIL').length,results}));
}catch(error){console.error(`PostgreSQL health check failed: ${error.message}`);process.exitCode=1;}
finally{await client.end().catch(()=>{});}
