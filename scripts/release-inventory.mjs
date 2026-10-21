import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {learningData as learning} from '../public/learning-data.js';
import {subjectImages} from '../public/subject-images.js';
import {api} from '../site-server/handler.js';
import {researchedDossiers} from '../catalogue-editorial/dossier-research.js';

mkdirSync('release',{recursive:true});
mkdirSync('.sites-runtime',{recursive:true});
const catalogue=new DatabaseSync('.sites-runtime/artwork-preview.sqlite',{readOnly:true});
const database=new DatabaseSync('.sites-runtime/release-review.sqlite');
database.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS image_subject(canonical_subject_id TEXT PRIMARY KEY,legacy_key TEXT UNIQUE,subject_type TEXT,exact_subject_name TEXT,identity_json TEXT);
CREATE TABLE IF NOT EXISTS image_registry(canonical_subject_id TEXT PRIMARY KEY REFERENCES image_subject,source_page TEXT,source_provider TEXT,creator TEXT,credit TEXT,license_or_permission TEXT,reuse_conditions TEXT,download_or_embed TEXT,local_asset_path TEXT,image_hash TEXT,dimensions TEXT,identity_evidence TEXT,reviewer TEXT,review_timestamp TEXT,last_http_check TEXT,browser_render_check TEXT,status TEXT,error_reason TEXT);
CREATE TABLE IF NOT EXISTS image_requirement(requirement_id TEXT PRIMARY KEY,page_url TEXT,placement TEXT,canonical_subject_id TEXT REFERENCES image_subject,condition TEXT);
CREATE TABLE IF NOT EXISTS image_candidate(candidate_id TEXT PRIMARY KEY,canonical_subject_id TEXT REFERENCES image_subject,candidate_url TEXT,source_page TEXT,source_provider TEXT,status TEXT,metadata_json TEXT);
CREATE TABLE IF NOT EXISTS acquisition_queue(canonical_subject_id TEXT PRIMARY KEY REFERENCES image_subject,search_query TEXT,provider TEXT,status TEXT DEFAULT 'QUEUED',attempts INTEGER DEFAULT 0,next_attempt_at TEXT,last_error TEXT);
CREATE TABLE IF NOT EXISTS acquisition_attempt(id INTEGER PRIMARY KEY,canonical_subject_id TEXT,provider TEXT,attempted_at TEXT,http_status INTEGER,outcome TEXT,evidence_path TEXT,error_reason TEXT);
CREATE TABLE IF NOT EXISTS provider_checkpoint(provider TEXT PRIMARY KEY,not_before TEXT,reason TEXT);
CREATE INDEX IF NOT EXISTS image_requirement_subject ON image_requirement(canonical_subject_id);
CREATE INDEX IF NOT EXISTS image_candidate_subject ON image_candidate(canonical_subject_id);
CREATE TABLE IF NOT EXISTS image_requirement_history(requirement_id TEXT PRIMARY KEY,page_url TEXT,placement TEXT,canonical_subject_id TEXT,condition TEXT,recorded_at TEXT);
INSERT OR IGNORE INTO image_requirement_history SELECT requirement_id,page_url,placement,canonical_subject_id,condition,datetime('now') FROM image_requirement;
DELETE FROM image_requirement WHERE rowid NOT IN (SELECT MIN(rowid) FROM image_requirement GROUP BY page_url,placement,canonical_subject_id);
CREATE UNIQUE INDEX IF NOT EXISTS image_requirement_placement ON image_requirement(page_url,placement,canonical_subject_id);
`);
const old=JSON.parse(readFileSync('release-audit/image-coverage.json','utf8'));
const films=catalogue.prepare('SELECT rowid,* FROM work').all();
const editorial=await (await api(new Request('http://local/api/editorial'),{})).json();
const canonical=key=>{
 if(key.startsWith('camera-timeline/')){
  const cam=learning.cameraTimeline[Number(key.split('/')[1])];
  const entry=learning.technology.flatMap(g=>g.items.map(i=>({g,i}))).find(({i})=>i.name.toLowerCase()===cam?.name.toLowerCase());
  if(entry)return `technology/${entry.g.id}/${entry.i.slug}`;
 }
 return key;
};
const subjects=new Map();
for(const r of old.records){const key=canonical(r.key);if(!subjects.has(key))subjects.set(key,{...r,key,legacy_keys:[]});subjects.get(key).legacy_keys.push(r.key);}
const insertSubject=database.prepare('INSERT INTO image_subject VALUES(?,?,?,?,?) ON CONFLICT(canonical_subject_id) DO UPDATE SET legacy_key=excluded.legacy_key,subject_type=excluded.subject_type,exact_subject_name=excluded.exact_subject_name,identity_json=excluded.identity_json');
const insertRegistry=database.prepare('INSERT OR IGNORE INTO image_registry VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insertQueue=database.prepare('INSERT OR IGNORE INTO acquisition_queue(canonical_subject_id,search_query,provider) VALUES(?,?,?)');
const candidate=database.prepare('INSERT OR IGNORE INTO image_candidate VALUES(?,?,?,?,?,?,?)');
database.exec('BEGIN');
for(const r of subjects.values()){
 insertSubject.run(r.key,r.key,r.kind,r.label,JSON.stringify(r.identity));
 const image=r.legacy_keys.map(k=>subjectImages[k]).find(Boolean);
 const file=image?'public'+image.url:null;
 const initial=image&&existsSync(file)?'VERIFIED_LICENSED_LOCAL':r.inherited_media_candidates?.length?'RIGHTS_PENDING':'IDENTITY_PENDING';
 insertRegistry.run(r.key,image?.source_page||null,image?'Wikimedia Commons':null,image?.creator||null,image?.caption||null,image?.license||null,image?.license_url||null,image?'LOCAL':null,file,file&&existsSync(file)?createHash('sha256').update(readFileSync(file)).digest('hex'):null,image?`${image.width}x${image.height}`:null,image?.evidence||null,image?'Prior checkpoint visual and file-page review':null,image?.retrieved_at||null,image?'Download and decode verified in checkpoint; current browser check required':null,'NOT_RUN',initial,image?null:'Exact identity, permission and load evidence required; no substitute selected');
 if(!image)insertQueue.run(r.key,[r.label,r.identity?.year,r.identity?.director].filter(Boolean).join(' '),'commons');
 for(const c of r.inherited_media_candidates||[])candidate.run(c.asset_id,r.key,c.url,null,c.source_id,'RIGHTS_PENDING',JSON.stringify(c));
 for(const c of r.inherited_artwork||[])candidate.run(c.id,r.key,null,c.source,'Wikimedia Commons','RIGHTS_PENDING',JSON.stringify(c));
}
database.exec('COMMIT');
const req=database.prepare('INSERT INTO image_requirement VALUES(?,?,?,?,?) ON CONFLICT(page_url,placement,canonical_subject_id) DO UPDATE SET condition=excluded.condition');
const placements=[];
function place(key,page,slot,condition='ALWAYS'){
 key=canonical(key);if(!subjects.has(key))throw Error('Uninventoried subject '+key);
 const id=createHash('sha256').update(JSON.stringify([key,page,slot])).digest('hex').slice(0,24);
 req.run(id,page,slot,key,condition);placements.push({requirement_id:id,page_url:page,placement:slot,canonical_subject_id:key,condition});
}
database.exec('BEGIN');
for(const g of learning.technology){
 place(`technology/${g.id}/cover`,'/technology','discipline-card');
 place(`technology/${g.id}/cover`,`/technology/${g.id}`,'discipline-hero');
 for(const i of g.items){place(`technology/${g.id}/${i.slug}`,`/technology/${g.id}`,'entry-card:'+i.slug);place(`technology/${g.id}/${i.slug}`,`/technology/${g.id}/${i.slug}`,'entry-detail');}
}
for(const g of learning.crew){
 place(`crew/${g.id}/cover`,'/crew','department-card');place(`crew/${g.id}/cover`,`/crew/${g.id}`,'department-hero');
 for(const i of g.items){place(`crew/${g.id}/${i.slug}`,`/crew/${g.id}`,'role-card:'+i.slug);place(`crew/${g.id}/${i.slug}`,`/crew/${g.id}/${i.slug}`,'role-detail');place(`crew/${g.id}/${i.slug}`,'/crew','role-search:'+i.slug,'MATCHES_ROLE_QUERY');}
}
learning.cameraTimeline.forEach((c,i)=>place('camera-timeline/'+i,'/technology/cameras','camera-milestone:'+i));
for(const key of Object.keys(subjectImages))place(key,'/attributions','credit-gallery:'+key);
const directors=new Map(),years=new Map();
for(const f of films){if(f.director){const a=directors.get(f.director)||[];a.push(f);directors.set(f.director,a);}if(f.year!=null){const a=years.get(f.year)||[];a.push(f);years.set(f.year,a);}}
const compare=(a,b)=>Buffer.compare(Buffer.from(a.title),Buffer.from(b.title))||a.rowid-b.rowid;
for(const list of [...directors.values(),...years.values()])list.sort(compare);
for(const f of films){
 const key='film/'+f.id,detail='/film/'+f.id;
 place(key,detail,'dossier-artwork');place(key,'/discover','search-result:'+f.id,'MATCHES_FILTER_AND_PAGE');
 place(key,'/contemporary','search-result:'+f.id,'MATCHES_FILTER_AND_PAGE');
 for(const slot of ['saved','watched'])place(key,'/my-cinema',slot+':'+f.id,'USER_NOTEBOOK_CONTAINS_ID');
 place(key,'/watch','viewing-result:'+f.id,'CURRENT_SOURCE_GATE_AND_FILTER');
 for(const slot of ['featured','carousel','history'])place(key,'/','programme-'+slot+':'+f.id,'CHOSEN_BY_SESSION_PROGRAMMING');
 if(f.director)place(key,'/person/'+encodeURIComponent(f.director),'filmography:'+f.id,'EXACT_DIRECTOR_FILTER_PAGINATED');
 const related=[...(directors.get(f.director)||[]).filter(x=>x.id!==f.id),...(years.get(f.year)||[]).filter(x=>x.id!==f.id&&x.director!==f.director)].slice(0,8);
 for(const r of related)place('film/'+r.id,detail,'related-card:'+r.id);
}
for(const r of subjects.values()){
 if(r.kind==='director-credit')place(r.key,r.route,'credit-profile-photo');
 if(r.kind==='essay'){
  place(r.key,r.route,'essay-hero');for(const route of ['/journal','/world','/my-cinema'])place(r.key,route,'essay-card:'+r.identity.id,'ESSAY_CARD_HAS_NO_CONNECTED_FILM');
 }
 if(['navigation-scene','museum-scene','world-navigation'].includes(r.kind))place(r.key,r.route,'scene:'+r.key,'MATCHING_UI_SLOT');
}
database.exec('COMMIT');

const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
function exportCSV(name,rows){const fields=[...new Set(rows.flatMap(r=>Object.keys(r)))];writeFileSync('release/'+name,[fields.map(csv).join(','),...rows.map(r=>fields.map(k=>csv(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(','))].join('\n'));}
const records=database.prepare('SELECT s.*,r.* FROM image_subject s JOIN image_registry r USING(canonical_subject_id)').all();
const requirements=database.prepare('SELECT q.*,r.status,r.error_reason,r.browser_render_check FROM image_requirement q JOIN image_registry r USING(canonical_subject_id)').all();
exportCSV('IMAGE_REQUIREMENTS.csv',requirements);exportCSV('IMAGE_REGISTRY.csv',records);
writeFileSync('release/IMAGE_REGISTRY.json',JSON.stringify(records,null,2));
exportCSV('IMAGE_EXCEPTIONS.csv',records.filter(r=>!r.status.startsWith('VERIFIED_')));
const editorialRows=[];
function editorialRow(page,type,title,text,sources=[],extra={}){
 const words=String(text||'').trim().split(/\s+/).filter(Boolean).length;
 editorialRows.push({page_url:page,type,title,word_count:words,source_count:sources.length,status:words<120||!sources.length?'INTRODUCTION_OR_STUB':'REVIEW_NEEDED',fact_check:'NOT_INDEPENDENTLY_COMPLETED',sources:JSON.stringify(sources),...extra});
}
for(const g of learning.technology){editorialRow('/technology/'+g.id,'technology-group',g.title,g.context,Object.values(learning.sources));for(const i of g.items){const cam=learning.cameraTimeline.find(c=>c.name.toLowerCase()===i.name.toLowerCase());editorialRow(`/technology/${g.id}/${i.slug}`,'technology',i.name,cam?.description||i.brief,cam?[learning.sources[cam.source]]:[]);}}
for(const g of learning.crew){editorialRow('/crew/'+g.id,'crew-department',g.title,g.context,Object.values(learning.sources));for(const i of g.items)editorialRow(`/crew/${g.id}/${i.slug}`,'crew-role',i.name,i.profile?Object.values(i.profile).filter(x=>typeof x==='string').join(' '):i.brief,i.profile?[learning.sources[i.profile.source]].filter(Boolean):[],{aliases:JSON.stringify(i.profile?.aliases||[])});}
for(const e of editorial.essays)editorialRow('/essay/'+e.id,'essay',e.title,[e.deck,...(e.paragraphs||[]),...(e.sections||[]).flatMap(s=>[s.heading,...(s.paragraphs||[])])].join(' '),e.sources||[],{inherited_status:e.editorial_status});
const editorialFilms=new Map(editorial.films.map(f=>[f.id,f]));
for(const f of films){const prose=editorialFilms.get(f.id),research=researchedDossiers[f.id];editorialRow('/film/'+f.id,'film-dossier',f.title,[prose?.synopsis,prose?.significance,prose?.programmeNote,...(research?.paragraphs||[])].filter(Boolean).join(' '),[...(prose?.sources||[]),...(research?.sources||[])],{identity_missing:!f.year||!f.director});}
for(const name of directors.keys())editorialRow('/person/'+encodeURIComponent(name),'credit-profile',name,'',[],{identity:'Unresolved director-credit string; not necessarily one person'});
exportCSV('EDITORIAL_AUDIT.csv',editorialRows);
const sourceRows=catalogue.prepare('SELECT * FROM source').all();
const evidenceRows=catalogue.prepare('SELECT * FROM evidence').all();
const viewing=new Map();const now=Date.now();
for(const row of evidenceRows){const p=JSON.parse(row.payload),id=JSON.stringify([row.work_id,p.canonical_source_url||'']);viewing.set(id,{source_id:id,work_id:row.work_id,url:p.canonical_source_url||'',source_owner:p.source_owner||'',historical_state:p.watch_state||'CATALOGUE_ONLY',last_checked_at:p.last_checked_at||'',current_eligibility:'CATALOGUE_ONLY',fresh_probe:'NOT_RUN',failure_reason:'No current permission/availability verification record'});}
for(const row of sourceRows){const p=JSON.parse(row.payload);const eligible=row.checked_ms<=now&&row.expires_ms>now;const key=JSON.stringify([row.work_id,p.canonical_source_url||p.external_watch_url||'']);const previous=viewing.get(key);viewing.set(key,{source_id:row.source_id,other_source_ids:previous?.source_id||'',work_id:row.work_id,url:p.external_watch_url||p.canonical_source_url,source_owner:p.source_owner,historical_state:row.watch_state,last_checked_at:p.last_checked_at,expires_at:new Date(row.expires_ms).toISOString(),current_eligibility:eligible?row.watch_state:'CATALOGUE_ONLY',fresh_probe:'NOT_RUN',failure_reason:eligible?'':'Inherited verification expired; HTTP alone cannot renew authorization'});}
exportCSV('VIEWING_AVAILABILITY_REPORT.csv',[...viewing.values()]);
const integrity={checked_at:new Date().toISOString(),database:'bundled D1-compatible SQLite restored from immutable publication files',quick_check:catalogue.prepare('PRAGMA quick_check').all(),foreign_key_check:catalogue.prepare('PRAGMA foreign_key_check').all(),works:films.length,source_rows:sourceRows.length,evidence_rows:evidenceRows.length,orphan_sources:catalogue.prepare('SELECT COUNT(*) n FROM source s LEFT JOIN work w ON s.work_id=w.id WHERE w.id IS NULL').get().n,orphan_artwork:catalogue.prepare('SELECT COUNT(*) n FROM artwork_record a LEFT JOIN work w ON a.work_id=w.id WHERE w.id IS NULL').get().n,missing_year_or_director:films.filter(f=>!f.year||!f.director).length,unknown_runtime:films.filter(f=>!f.runtime).length,source_refresh:'NOT_COMPLETED'};
writeFileSync('release/evidence/DATABASE_INTEGRITY.json',JSON.stringify(integrity,null,2));
const summary={timestamp:new Date().toISOString(),legacy:{records:old.records.length,pending:old.records.filter(r=>r.status!=='APPROVED_LOCAL').length},canonical_subjects:records.length,canonical_alias_merges:old.records.length-records.length,placement_requirements:requirements.length,placement_semantics:'Concrete per-subject page/template slots. Conditional programming/search/notebook slots are potential render requirements, not claimed simultaneously visible images. Same responsive DOM image is one placement requiring six viewport checks.',subject_statuses:database.prepare('SELECT status,count(*) total FROM image_registry GROUP BY status').all(),placement_statuses:database.prepare('SELECT r.status,count(*) total FROM image_requirement q JOIN image_registry r USING(canonical_subject_id) GROUP BY r.status').all(),candidate_records:database.prepare('SELECT count(*) n FROM image_candidate').get().n,queued_subjects:database.prepare('SELECT count(*) n FROM acquisition_queue').get().n,editorial_pages:editorialRows.length,editorial_statuses:Object.fromEntries(['INTRODUCTION_OR_STUB','REVIEW_NEEDED'].map(s=>[s,editorialRows.filter(r=>r.status===s).length])),viewing_records:viewing.size,current_eligible_sources:[...viewing.values()].filter(r=>r.current_eligibility!=='CATALOGUE_ONLY').length,unaccounted_placements:'Runtime DOM reconciliation still required; counts are source-derived, not a completed browser crawl',release_ready:false};
writeFileSync('release/INVENTORY_RECONCILIATION.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));database.close();catalogue.close();
