import pg from 'pg';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const args=new Map(process.argv.slice(2).filter(a=>a.startsWith('--')).map(a=>{const [k,...v]=a.slice(2).split('=');return [k,v.join('=')||true];}));
const limit=Number(args.get('limit')||250),runArg=args.get('run'),newRun=args.has('new-run');
if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('--limit must be 1..1000');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-institutional-artwork-recovery'});
try{
 await c.connect();
 const policy={
  nfb_canada:{status:'RESTRICTED_WRITTEN_PERMISSION_REQUIRED',url:'https://help.nfb.ca/terms/',reason:'NFB terms require written licence for non-private content use.'},
  bfi_player_free:{status:'RESTRICTED_AUTHORIZATION_REQUIRED',url:'https://player.bfi.org.uk/terms-of-use',reason:'BFI Player terms reserve service content and prohibit copying/display/republication, scraping, data mining or extraction without authorization.'},
  mosfilm:{status:'RESTRICTED_PERMISSION_REQUIRED',url:'https://www.mosfilm.ru/user-agreement/',reason:'The current www.mosfilm.ru user agreement limits Materials to personal, non-commercial use on one computer and prohibits other-site copying, republication or distribution without special permission.'},
  cinematheque_henri:{status:'UNRESOLVED_ITEM_RIGHTS_REVIEW_REQUIRED',url:'https://www.cinematheque.fr/mentions-legales.html',reason:'No item-level image licence is stored.'},
  retina_latina:{status:'UNRESOLVED_ITEM_RIGHTS_REVIEW_REQUIRED',url:'https://www.retinalatina.org/',reason:'Viewing availability is not image-republication permission.'},
  '35mm_online':{status:'UNRESOLVED_ITEM_RIGHTS_REVIEW_REQUIRED',url:'https://35mm.online/',reason:'No item-level image licence or attribution is stored.'}
 };
 for(const [provider,p] of Object.entries(policy))await c.query(`INSERT INTO artwork_provider_policy(provider,policy_status,can_republish,attribution_required,source_url,rights_basis,technical_notes) VALUES($1,$2,FALSE,TRUE,$3,$4,$5) ON CONFLICT(provider) DO UPDATE SET policy_status=EXCLUDED.policy_status,can_republish=FALSE,source_url=EXCLUDED.source_url,rights_basis=EXCLUDED.rights_basis,technical_notes=EXCLUDED.technical_notes,reviewed_at=NOW()`,[provider,p.status,p.url,p.reason,'Existing asset URL reachability does not change the rights decision.']);
 let run=runArg?(await c.query('SELECT * FROM artwork_enrichment_run WHERE run_id=$1',[runArg])).rows[0]:null;
 if(runArg&&!run)throw Error('RECOVERY_RUN_NOT_FOUND');
 if(run&&run.mode!=='institutional-existing')throw Error('RECOVERY_MODE_MISMATCH');
 if(!run&&!newRun)run=(await c.query("SELECT * FROM artwork_enrichment_run WHERE mode='institutional-existing' AND status IN ('RUNNING','PAUSED') ORDER BY started_at DESC LIMIT 1")).rows[0];
 if(!run){run=(await c.query("INSERT INTO artwork_enrichment_run(mode,scope,batch_size) VALUES('institutional-existing','14,470 original media_asset rows', $1) RETURNING *",[limit])).rows[0];}
 const assets=(await c.query("SELECT asset_id,work_id,source_id,asset_type,canonical_url,usage_basis,license_verified,review_status,health_status,source_page_url,metadata FROM media_asset WHERE source_id<>'WIKIMEDIA_COMMONS' ORDER BY asset_id")).rows;
 let cursor=Number(run.checkpoint?.cursor||0);if(run.status==='COMPLETED'){console.log(JSON.stringify({run_id:run.run_id,status:'COMPLETED',skipped:true}));await c.end();process.exit(0);}
 const batch=assets.slice(cursor,cursor+limit);await c.query('BEGIN');try{for(const a of batch){const p=policy[a.source_id]||{status:'UNRESOLVED_PROVIDER_POLICY',url:'',reason:'Provider policy is not established in this snapshot.'};const decision=a.license_verified&&a.review_status==='APPROVED'&&a.health_status==='HEALTHY'?'ELIGIBLE_ALREADY_APPROVED':'RIGHTS_BLOCKED_EXISTING_REFERENCE';await c.query(`INSERT INTO artwork_institutional_recovery_item(run_id,asset_id,work_id,provider,status,reason,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(run_id,asset_id) DO NOTHING`,[run.run_id,a.asset_id,a.work_id,a.source_id,decision,decision==='ELIGIBLE_ALREADY_APPROVED'?'Existing approval is retained; no rewrite.':p.reason,JSON.stringify({source_page_url:a.source_page_url,canonical_url:a.canonical_url,asset_type:a.asset_type,usage_basis:a.usage_basis,health_status:a.health_status,policy_url:p.url,identity_status:'SOURCE_RELATION_UNREVIEWED'})]);}await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
 const next=cursor+batch.length,counts=Object.fromEntries((await c.query('SELECT status,count(*)::integer count FROM artwork_institutional_recovery_item WHERE run_id=$1 GROUP BY status',[run.run_id])).rows.map(r=>[r.status,r.count]));const status=next>=assets.length?'COMPLETED':'PAUSED';await c.query('UPDATE artwork_enrichment_run SET status=$2,checkpoint=$3::jsonb,counts=$3::jsonb,finished_at=CASE WHEN $2=\'COMPLETED\' THEN NOW() ELSE NULL END WHERE run_id=$1',[run.run_id,status,JSON.stringify({cursor:next,total:assets.length,counts})]);await writeFile(resolve(root,'docs/institutional-artwork-recovery-checkpoint.json'),JSON.stringify({run_id:run.run_id,status,cursor:next,total:assets.length,counts,updated_at:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify({run_id:run.run_id,status,cursor:next,total:assets.length,counts}));
}finally{await c.end();}
