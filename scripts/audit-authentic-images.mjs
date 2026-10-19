import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {learningData} from '../public/learning-data.js';
import {subjectImages, approvedSubjectImage} from '../public/subject-images.js';
import {api} from '../site-server/handler.js';

mkdirSync('release-audit', {recursive:true});
const db = new DatabaseSync('.sites-runtime/artwork-preview.sqlite', {readOnly:true});
const rows=[];
const inheritedMedia=existsSync('release-audit/inherited-media-candidates.json')?JSON.parse(readFileSync('release-audit/inherited-media-candidates.json','utf8')):[];
const mediaByWork=new Map();for(const image of inheritedMedia){const list=mediaByWork.get(image.work_id)||[];list.push({asset_id:image.asset_id,url:image.canonical_url,source_id:image.source_id,status:'RIGHTS_UNVERIFIED'});mediaByWork.set(image.work_id,list);}
function add(key,kind,label,identity,route,extra={}) {
  const image=approvedSubjectImage(key);
  const file=image?'public'+image.url:null;
  rows.push({key,kind,label,identity,route,status:image&&existsSync(file)?'APPROVED_LOCAL':'PENDING',
    image:image?{...image,sha256:existsSync(file)?createHash('sha256').update(readFileSync(file)).digest('hex'):null}:null,...extra});
}
for(const g of learningData.technology) {
  add(`technology/${g.id}/cover`,'technology-group',g.title,{group:g.id},`/technology/${g.id}`);
  for(const i of g.items)add(`technology/${g.id}/${i.slug}`,'technology',i.name,{group:g.id,slug:i.slug},`/technology/${g.id}/${i.slug}`);
}
for(const g of learningData.crew) {
  add(`crew/${g.id}/cover`,'crew-department',g.title,{group:g.id},`/crew/${g.id}`);
  for(const i of g.items)add(`crew/${g.id}/${i.slug}`,'crew-role',i.name,{group:g.id,slug:i.slug},`/crew/${g.id}/${i.slug}`,{aliases:i.profile?.aliases||[]});
}
learningData.cameraTimeline.forEach((c,i)=>add(`camera-timeline/${i}`,'camera-milestone',c.name,{name:c.name,year:c.year},'/technology/cameras',{inherited_candidate:c.photo||null}));
const films=db.prepare('SELECT * FROM work ORDER BY id').all();
const assets=db.prepare('SELECT * FROM artwork_record').all();
for(const f of films)add('film/'+f.id,'film',f.title,{id:f.id,year:f.year,director:f.director},'/film/'+encodeURIComponent(f.id),{inherited_media_candidates:mediaByWork.get(f.id)||[],inherited_artwork:assets.filter(a=>a.work_id===f.id).map(a=>({id:a.id,source:a.source_url,status:'RECHECK_REQUIRED'}))});
const names=[...new Set(films.map(f=>f.director).filter(Boolean))];
for(const name of names)add('person/'+name,'director-credit',name,{name,identity_status:'CREDIT_STRING_REQUIRES_AUTHORITY_ID'},'/person/'+encodeURIComponent(name));
const editorial=await (await api(new Request('http://local/api/editorial'),{})).json();
for(const e of editorial.essays)add('essay/'+e.id,'essay',e.title,{id:e.id},'/essay/'+e.id);
for(const id of ['many-beginnings','montage-as-thought','beyond-one-world-cinema'])add('destination//essay/'+id,'navigation-scene',id,{essay:id},'/world');
for(const id of ['entry','01','02','03','04','05','06'])add('museum/'+id,'museum-scene',id,{station:id},'/museum');
for(const id of ['technology','crew'])add('world/'+id,'world-navigation',id,{destination:id},'/world');
const counts={};for(const r of rows){counts[r.kind]??={total:0,approved:0,pending:0};counts[r.kind].total++;counts[r.kind][r.status==='APPROVED_LOCAL'?'approved':'pending']++;}
const summary={checked_at:new Date().toISOString(),scope:'V5 learning data, bundled catalogue, editorial API and identified destination/museum/world slots. Browser route crawl remains required.',counts,profile_aliases:learningData.crew.flatMap(g=>g.items.flatMap(i=>i.profile?.aliases||[])).length,release_ready:false,blockers:['Unresolved subject photographs','Inherited film images require current probe and rights review','Browser route crawl incomplete','PostgreSQL restore and source refresh incomplete','Android and desktop rendered QA incomplete']};
writeFileSync('release-audit/image-coverage.json',JSON.stringify({summary,records:rows},null,2));
const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
writeFileSync('release-audit/image-coverage.csv',['key,kind,label,route,status',...rows.map(r=>[r.key,r.kind,r.label,r.route,r.status].map(csv).join(','))].join('\n'));
writeFileSync('release-audit/summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
if(process.argv.includes('--release'))process.exitCode=rows.some(r=>r.status!=='APPROVED_LOCAL')||summary.blockers.length?1:0;
