import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createRun, persistEnumeration, persistVerification, finishSource, finishRun } from '../db/ingestion-store.mjs';
import { enumerateSource } from '../lib/ingestion/catalogues.mjs';
import { verifyCandidate } from '../lib/ingestion/verification.mjs';
import { httpForSource } from '../lib/ingestion/provider-policy.mjs';
import { checkpointHttp } from '../lib/ingestion/enumeration-checkpoint.mjs';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required. Existing database/migrations are never reset by this runner.'); process.exit(2); }
const root = resolve(import.meta.dirname, '..');
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const resume = option('resume');
const enumerationDirectory = option('enumeration-dir') ? resolve(option('enumeration-dir')) : null;
const reportOnly = process.argv.includes('--report-only') || process.argv.includes('--enumerate-only');
const selected = process.argv.filter((arg) => arg.startsWith('--source=')).map((arg) => arg.slice(9));
const priority = option('priority');
const concurrency = Number(process.env.INGEST_CONCURRENCY || 4);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('INGEST_CONCURRENCY must be 1..16 (concurrency, not a catalogue-size cap)');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-source-sweep' });
let runId;
let writeQueue = Promise.resolve();
const commit = (action) => { const next = writeQueue.then(action); writeQueue = next; return next; };
async function pool(items, worker) {
  let cursor = 0, failure;
  async function run() { while (!failure) { const index = cursor++; if (index >= items.length) return; try { await worker(items[index], index); } catch (error) { failure = error; } } }
  await Promise.all(Array.from({length:Math.min(concurrency, items.length)},run));
  if (failure) throw failure;
}
try {
  await client.connect();
  // One supervised sweep at a time; health/export may still run. Advisory locks do not reset data.
  const lock = (await client.query("SELECT pg_try_advisory_lock(hashtext('global-cinema-source-sweep')) AS acquired")).rows[0];
  if (!lock.acquired) throw new Error('A source sweep is already running; resume it instead of launching a competing sweep.');
  let registry = JSON.parse(await readFile(resolve(root,'src/data/source-registry.json'),'utf8'));
  if (resume) {
    const run = (await client.query('SELECT * FROM ingest_run WHERE run_id=$1',[resume])).rows[0];
    if (!run || run.store_version !== 1) throw new Error('Unknown resumable run');
    if (run.finished_at) { console.log(JSON.stringify({run_id:resume,status:run.status,skipped:true,reason:'Run already finished; no catalogue or evidence restarted.'})); }
    else { runId = resume; registry = run.registry_snapshot; }
  } else {
    const all = [...registry.sources,...registry.rights_holder_channels_to_enumerate];
    if (selected.some((id)=>!all.some((source)=>source.id===id))) throw new Error('Unknown registry --source');
    if (selected.length || priority) {
      registry = { ...registry, sources: registry.sources.filter((source)=>(!selected.length||selected.includes(source.id))&&(!priority||source.priority===priority)),
        rights_holder_channels_to_enumerate: registry.rights_holder_channels_to_enumerate.filter((source)=>(!selected.length||selected.includes(source.id))&&(!priority||source.priority===priority)) };
    }
    runId = await createRun(client,{registry});
    if (enumerationDirectory) {
      await mkdir(enumerationDirectory,{recursive:true});
      const checkpoint = resolve(enumerationDirectory,`database-run-${runId}.json`);
      await writeFile(checkpoint,`${JSON.stringify({run_id:runId,resume_command:`node scripts/sweep-sources.mjs --resume=${runId}`,created_at:new Date().toISOString()},null,2)}\n`,{flag:'wx'});
    }
  }
  if (runId) {
    const sources = [...registry.sources,...registry.rights_holder_channels_to_enumerate];
    console.log(JSON.stringify({run_id:runId,targets:sources.map((source)=>source.id),mode:reportOnly?'ENUMERATE_ONLY':'SOURCE_SWEEP',concurrency}));
    // Commit ALL discoveries before slow verification. An interruption cannot discard the catalogue.
    for (const source of sources) {
      const prior = (await client.query('SELECT result_json FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2',[runId,source.id])).rows[0];
      if (prior) continue;
      let result;
      if (enumerationDirectory) {
        try { result=JSON.parse(await readFile(resolve(enumerationDirectory,`${source.id}.json`),'utf8')); }
        catch(error) { if(error.code!=='ENOENT') throw error; }
      }
      if (!result) {
        const http = await checkpointHttp(source, enumerationDirectory); const started = new Date().toISOString();
        result = {...await enumerateSource(source,http),started_at:started,checked_at:new Date().toISOString(),requests:http.requests,policy_evidence:http.policyEvidence || []};
      }
      const saved = await persistEnumeration(client,runId,source,result);
      console.log(JSON.stringify({run_id:runId,source:source.id,stage:'enumeration-persisted',candidates:saved.candidates,status:result.status,enumeration_complete:result.enumeration_complete}));
    }
    if (reportOnly) {
      console.log(JSON.stringify({run_id:runId,status:'RUNNING',stage:'enumerations-persisted',verification:'NOT_RUN',resume_command:`node scripts/sweep-sources.mjs --resume=${runId}`}));
    } else {
      for (const source of sources) {
        const group=(await client.query('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2',[runId,source.id])).rows[0];
        if(group.finished_at) continue;
        const pending=(await client.query(`SELECT c.candidate_json FROM ingest_candidate c LEFT JOIN source_verification v ON v.ingest_run_id=c.ingest_run_id AND v.candidate_id=c.candidate_id
          WHERE c.ingest_run_id=$1 AND c.registry_source_id=$2 AND v.verification_id IS NULL ORDER BY c.source_url`,[runId,source.id])).rows.map((row)=>row.candidate_json);
        const http=httpForSource(source); let checked=0;
        await pool(pending,async(candidate)=>{
          const record=await verifyCandidate(source,candidate,http);
          await commit(()=>persistVerification(client,runId,source,candidate,record));
          checked++;
          if(checked%250===0) console.log(JSON.stringify({run_id:runId,source:source.id,stage:'verification-checkpoint',new_checks:checked,remaining:pending.length-checked}));
        });
        const finished=await finishSource(client,runId,source.id,{verification_attempted:true,requests:http.requests,source_errors_are_not_watchable:true});
        console.log(JSON.stringify({run_id:runId,source:source.id,stage:'source-finished',status:finished.status,counts:finished.counts}));
      }
      const result=await finishRun(client,runId,{source_errors_are_not_watchable:true,counts_source:'postgresql',arbitrary_title_cap:null});
      console.log(JSON.stringify({run_id:runId,...result}));
    }
  }
} catch(error) {
  console.error(JSON.stringify({run_id:runId||null,error:error.message,code:error.code||null,preserved:true,resume_command:runId?`node scripts/sweep-sources.mjs --resume=${runId}`:null}));
  process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
