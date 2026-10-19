// Temporary report/export follower for a long-running persisted sweep, not an installed service.
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const runId=process.argv.find((arg)=>arg.startsWith('--run='))?.slice(6);
if(!process.env.DATABASE_URL||!runId){console.error('DATABASE_URL and --run=<persisted run UUID> are required.');process.exit(2);}
const root=resolve(import.meta.dirname,'..');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'global-cinema-sweep-report-follow'});
const refresh=()=>{
  for(const [script,args] of [['db-catalogue-report.mjs',[`--run=${runId}`,'--output=.research/source-sweep-report.json']],['db-export-public.mjs',['--output=src/data/ingested-catalogue.js']]]){
    const result=spawnSync(process.execPath,[resolve(root,'scripts',script),...args],{cwd:root,env:process.env,stdio:'inherit'});
    if(result.error||result.status!==0)throw new Error(`Report/export failed: ${script}`);
  }
};
let stop=false,interrupt;
process.once('SIGTERM',()=>{stop=true;interrupt?.();});process.once('SIGINT',()=>{stop=true;interrupt?.();});
try{
  await client.connect();let nextRefresh=0;
  while(!stop){
    const run=(await client.query('SELECT status,finished_at FROM ingest_run WHERE run_id=$1',[runId])).rows[0];
    if(!run)throw new Error('Unknown persisted sweep');
    if(Date.now()>=nextRefresh||run.finished_at){refresh();nextRefresh=Date.now()+5*60*1000;}
    if(run.finished_at){console.log(JSON.stringify({run_id:runId,status:run.status,final_report:'.research/source-sweep-report.json',finished:true}));break;}
    const running=(await client.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='global-cinema-source-sweep') AS active")).rows[0].active;
    if(!running){refresh();console.log(JSON.stringify({run_id:runId,status:'INTERRUPTED',preserved:true,resume_command:`node scripts/sweep-sources.mjs --resume=${runId}`}));break;}
    await new Promise((done)=>{const timer=setTimeout(done,30000);interrupt=()=>{clearTimeout(timer);done();};});interrupt=null;
  }
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await client.end().catch(()=>{});}
