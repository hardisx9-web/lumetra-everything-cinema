// Explicit production launch gate: never silently pass when source evidence is stale.
// Usage: LUMETRA_BASE_URL=https://staging.example node scripts/release-gate.mjs
import assert from 'node:assert/strict';
const base=process.env.LUMETRA_BASE_URL;
if(!base||!/^https:\/\//.test(base)){console.error('BLOCKED: Set LUMETRA_BASE_URL to the verified HTTPS staging URL.');process.exit(2);}
const blockers=[];
async function fetchJSON(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`${path} HTTP ${r.status}`);return r.json();}
try{
 const [stats,ed,watch]=await Promise.all([fetchJSON('/api/stats'),fetchJSON('/api/editorial'),fetchJSON('/api/films?watch=1&limit=1')]);
 if(stats.works!==20512)blockers.push(`Catalogue count changed to ${stats.works}; investigate snapshot and migrations`);
 if(!stats.ready||!stats.artwork_ready)blockers.push('Database or artwork import incomplete');
 if(!Number.isInteger(stats.eligible_sources)||stats.eligible_sources<=0)blockers.push('No fresh verified viewing sources');
 if(watch.total<=0)blockers.push('No publicly eligible film playback pathways');
 const researched=ed.essays.filter(e=>e.editorial_status==='RESEARCHED_DRAFT');
 if(researched.length<9)blockers.push('Latest research set is not deployed');
 if(stats.approved_artwork<9)blockers.push('Verified artwork selection missing');
 console.log(JSON.stringify({url:base,works:stats.works,eligible_sources:stats.eligible_sources,watchable_works:watch.total,research_features:researched.length,approved_artwork:stats.approved_artwork,blockers},null,2));
}catch(err){blockers.push(`Unable to validate staging: ${err.message}`);console.error(blockers.join('\n'));process.exit(2);}
if(blockers.length){console.error('PRODUCTION RELEASE BLOCKED. Do not bypass by fabricating film links or test data.');process.exit(1);}
console.log('Automated release gate passed. Manual UX, rights, editorial, security and rollback approvals still required.');
