import {artworkVersion} from './artwork-version.js';
import {programmeCountries} from './programming-dimensions.js';
const seedChunks=87;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const one=(db,sql,args=[])=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,args=[])=> (await db.prepare(sql).bind(...args).all()).results;
const parse=(value,fallback)=>{try{return JSON.parse(value??'null')??fallback;}catch{return fallback;}};
const decode=r=>({...r,countries:parse(r.countries,[]),alternate_titles:parse(r.alternate_titles,[]),watchable:!!r.watchable,embedded:!!r.embedded});
const selection=t=>`w.*,EXISTS(SELECT 1 FROM source s WHERE s.work_id=w.id AND s.checked_ms<=${t} AND s.expires_ms>${t}) watchable,EXISTS(SELECT 1 FROM source s WHERE s.work_id=w.id AND s.watch_state='WATCH_HERE' AND s.checked_ms<=${t} AND s.expires_ms>${t}) embedded`;
// Artwork never changes source verification or playback eligibility.
export const ARTWORK_WHERE=`verification_status='VERIFIED' AND review_status='APPROVED' AND health_status='HEALTHY' AND license_verified=1 AND match_confidence>=0.98 AND verified_at IS NOT NULL AND width>0 AND height>0 AND license_url LIKE 'https://%' AND license<>'' AND attribution<>'' AND source_url LIKE 'https://%'`;
export async function attachArtwork(db,rows){
 const output=[];
 for(let offset=0;offset<rows.length;offset+=80){
  const part=rows.slice(offset,offset+80),ids=part.map(x=>x.id),marks=ids.map(()=>'?').join(',');
  const assets=await all(db,`SELECT * FROM artwork_record WHERE work_id IN (${marks}) AND ${ARTWORK_WHERE} ORDER BY is_primary DESC,CASE artwork_type WHEN 'POSTER' THEN 0 ELSE 1 END,verified_at DESC,id`,ids);
  const metadata=await all(db,`SELECT work_id,payload FROM work_metadata WHERE work_id IN (${marks})`,ids);
  const byWork=new Map(),meta=new Map(metadata.map(r=>[r.work_id,parse(r.payload,{})]));
  for(const asset of assets)if(!byWork.has(asset.work_id))byWork.set(asset.work_id,asset);
  for(const row of part){
   const asset=byWork.get(row.id),m=meta.get(row.id)||{};
   output.push({...row,displayTitle:m.display_title||row.title,languages:Array.isArray(m.languages)?m.languages:[],genres:Array.isArray(m.genres)?m.genres:[],context:m.context||null,
    ...(asset?{artwork:{id:asset.id,work_id:row.id,url:asset.image_url,original_url:asset.original_url,source_page:asset.source_url,creator:asset.creator,license:asset.license,license_url:asset.license_url,attribution:asset.attribution,provider:asset.provider,artwork_type:asset.artwork_type,width:asset.width,height:asset.height,variants:parse(asset.variants,{}),alt:asset.alt||`${row.title}${row.year?' ('+row.year+')':''} — ${asset.artwork_type.toLowerCase()}`,language:asset.artwork_language,territory:asset.territory,verified_at:new Date(asset.verified_at).toISOString(),review_status:asset.review_status,health_status:asset.health_status,match_confidence:asset.match_confidence}}:{artwork:null})});
  }
 }
 return output;
}
export async function initialize(db,assets,origin='https://lumetra.invalid'){
 const row=await one(db,"SELECT value FROM publication_import WHERE key='cursor'");const cursor=Number(row?.value||0);
 if(cursor<seedChunks){
  const response=await assets.fetch(new Request(new URL('/publication/'+cursor+'.json',origin)));if(!response.ok)throw Error('Publication seed unavailable');
  const statements=await response.json(),end=cursor+1;
  await db.batch([...statements.map(x=>db.prepare(x.sql).bind(...x.values)),db.prepare("INSERT INTO publication_import(key,value) VALUES('cursor',?) ON CONFLICT(key) DO UPDATE SET value=CAST(max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").bind(String(end))]);
  return {ready:false,progress:Math.round(end/seedChunks*90),publication_progress:end};
 }
 const key='artwork:'+artworkVersion,imported=await one(db,'SELECT value FROM publication_import WHERE key=?',[key]);
 if(imported?.value==='DONE')return {ready:true,artwork_ready:true,progress:100};
 const response=await assets.fetch(new Request(new URL('/publication/artwork-manifest.json',origin)));if(!response.ok)throw Error('Artwork manifest unavailable; import can resume');
 const manifest=await response.json();if(manifest.version!==artworkVersion||!Array.isArray(manifest.chunks))throw Error('Artwork manifest version mismatch');
 const index=Number(imported?.value||0),chunks=manifest.chunks;
 if(index>=chunks.length){await db.batch([db.prepare('INSERT INTO publication_import(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,'DONE')]);return {ready:true,artwork_ready:true,progress:100};}
 const path=chunks[index];if(!/^\/publication\/artwork\/[a-z0-9-]+\.json$/.test(path))throw Error('Invalid artwork chunk');
 const chunk=await assets.fetch(new Request(new URL(path,origin)));if(!chunk.ok)throw Error('Artwork seed unavailable');
 const statements=await chunk.json();await db.batch([...statements.map(x=>db.prepare(x.sql).bind(...x.values)),db.prepare("INSERT INTO publication_import(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=CASE WHEN value='DONE' THEN value ELSE CAST(max(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT) END").bind(key,String(index+1))]);
 return {ready:false,artwork_progress:index+1,artwork_total:chunks.length,progress:90+Math.round((index+1)/Math.max(1,chunks.length)*10)};
}
export async function query(db,p){
 const page=Number(p.get('page')||1),limit=Number(p.get('limit')||24),q=(p.get('q')||'').trim(),country=p.get('country')||'',year=p.get('year')||'',genre=p.get('genre')||'',language=p.get('language')||'',director=p.get('director')||'';
 if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(limit)||limit<1||limit>48||q.length>160||country.length>100||genre.length>100||language.length>100||(year&&!/^\d{4}$/.test(year)))throw fail('Invalid search parameters');
 const t=Date.now(),args=[],terms=[];
 if(director.length>500)throw fail('Invalid director parameter');
 if(director){terms.push('w.director=?');args.push(director);}
 if(q){const phrase=q.split(/\s+/).map(x=>'"'+x.replaceAll('"','""')+'"*').join(' AND ');const like='%'+q.replace(/[\\%_]/g,x=>'\\'+x)+'%';terms.push('(w.id IN (SELECT id FROM search WHERE search MATCH ?)'+(new TextEncoder().encode(like).length<=50?" OR w.title LIKE ? ESCAPE '\\' OR w.original_title LIKE ? ESCAPE '\\' OR w.alternate_titles LIKE ? ESCAPE '\\' OR w.director LIKE ? ESCAPE '\\'":'')+')');args.push(phrase);if(new TextEncoder().encode(like).length<=50)args.push(...Array(4).fill(like));}
 if(country){terms.push('EXISTS(SELECT 1 FROM json_each(w.countries) WHERE value=?)');args.push(country);}if(year){terms.push('w.year=?');args.push(Number(year));}
 if(genre){terms.push("EXISTS(SELECT 1 FROM work_metadata m,json_each(m.payload,'$.genres') j WHERE m.work_id=w.id AND j.value=?)");args.push(genre);}
 if(language){terms.push("EXISTS(SELECT 1 FROM work_metadata m,json_each(m.payload,'$.languages') j WHERE m.work_id=w.id AND j.value=?)");args.push(language);}
 if(p.get('watch')==='1')terms.push(`EXISTS(SELECT 1 FROM source s WHERE s.work_id=w.id AND s.checked_ms<=${t} AND s.expires_ms>${t})`);
 const art=`w.id IN (SELECT work_id FROM artwork_record WHERE ${ARTWORK_WHERE})`;
 if(p.get('artwork')==='1')terms.push(art);
 const where=terms.length?' WHERE '+terms.join(' AND '):'',total=(await one(db,'SELECT count(*) n FROM work w'+where,args)).n;
 const items=(await all(db,`SELECT ${selection(t)} FROM work w${where} ORDER BY CASE WHEN ${art} THEN 0 ELSE 1 END,w.title,w.id LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit])).map(decode);
 return {items:await attachArtwork(db,items),total,page,limit,snapshot:true};
}
// Bounded read-only lookup for My Cinema; never save a user's notebook to the server.
export async function lookup(db, ids) {
 if (!Array.isArray(ids) || ids.length > 40 || ids.some(id => typeof id !== 'string' || !/^[\w-]{1,160}$/.test(id))) throw fail('Invalid film lookup');
 const unique=[...new Set(ids)];
 if(!unique.length)return {items:[]};
 const marks=unique.map(()=>'?').join(',');
 const t=Date.now();
 const rows=(await all(db,`SELECT ${selection(t)} FROM work w WHERE w.id IN (${marks})`,unique)).map(decode);
 const prepared=await attachArtwork(db,rows);
 const byId=new Map(prepared.map(f=>[f.id,f]));
 return {items:unique.map(id=>byId.get(id)).filter(Boolean)};
}

export async function dossier(db,id){
 if(!/^[\w-]{1,160}$/.test(id))throw fail('Invalid film ID');const t=Date.now(),r=await one(db,`SELECT ${selection(t)} FROM work w WHERE w.id=?`,[id]);if(!r)throw fail('Film not found',404);const w=(await attachArtwork(db,[decode(r)]))[0];
 const sources=(await all(db,'SELECT payload FROM source WHERE work_id=? AND checked_ms<=? AND expires_ms>?',[id,t,t])).map(x=>JSON.parse(x.payload));const evidence=(await all(db,'SELECT DISTINCT payload FROM evidence WHERE work_id=? LIMIT 30',[id])).map(x=>JSON.parse(x.payload));
 const related=(await all(db,`SELECT ${selection(t)} FROM work w WHERE id<>? AND ((? IS NOT NULL AND director=?) OR (? IS NOT NULL AND year=?)) ORDER BY CASE WHEN director=? THEN 0 ELSE 1 END,title LIMIT 8`,[id,w.director,w.director,w.year,w.year,w.director])).map(decode);
 return {...w,sources,evidence,related:await attachArtwork(db,related)};
}
const hash=value=>{let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const dimensions=x=>({countries:programmeCountries(x.countries),decades:x.year?[String(Math.floor(x.year/10)*10)]:[],languages:x.languages||[],genres:x.genres||[]});
function choose(candidates,count,seed,label,used,seen){
 const selected=[];
 while(selected.length<count){
  let best=null,bestScore=-Infinity;
  for(const x of candidates){if(used.has(x.id))continue;let score=hash(seed+':'+label+':'+x.id)/4294967296*24;
   for(const [key,values] of Object.entries(dimensions(x)))if(values.length)score+=values.reduce((sum,value)=>sum+16/(1+(seen[key].get(value)||0)),0)/values.length;
   if(x.artwork)score+=12;if(x.artwork?.artwork_type==='POSTER')score+=5;
   if(score>bestScore){best=x;bestScore=score;}
  }
  if(!best)break;selected.push(best);used.add(best.id);for(const [key,values] of Object.entries(dimensions(best)))for(const value of values)seen[key].set(value,(seen[key].get(value)||0)+1);
 }
 return selected;
}
export async function programming(db,p=new URLSearchParams()){
 const seed=p.get('seed')||new Date().toISOString().slice(0,10);if(!/^[\w-]{1,80}$/.test(seed))throw fail('Invalid programme seed');
 const salt=hash(seed),t=Date.now();
 // The pool rotates through the entire catalogue, rather than LIMIT 500 by ID.
 // All scarce licensed imagery is available for prominent slots, plus a bounded
 // stratified country/decade sample and separately gated official-viewing pool.
 const artworkRows=await all(db,`SELECT ${selection(t)} FROM work w WHERE id IN (SELECT work_id FROM artwork_record WHERE ${ARTWORK_WHERE}) ORDER BY ((w.rowid * ?)%2147483647) LIMIT 400`,[1009+salt%100000]);
 const diverse=await all(db,`WITH ranked AS (SELECT id,ROW_NUMBER() OVER (PARTITION BY COALESCE(json_extract(countries,'$[0]'),''),CAST(year/10 AS INTEGER) ORDER BY ((rowid * ?)%2147483647)) n FROM work) SELECT ${selection(t)} FROM work w JOIN ranked r ON r.id=w.id WHERE r.n=1 ORDER BY ((w.rowid * ?)%2147483647) LIMIT 240`,[1009+salt%100000,2003+salt%100003]);
 const viewing=await all(db,`SELECT ${selection(t)} FROM work w WHERE EXISTS(SELECT 1 FROM source s WHERE s.work_id=w.id AND s.checked_ms<=${t} AND s.expires_ms>${t}) ORDER BY ((w.rowid * ?)%2147483647) LIMIT 160`,[3001+salt%100019]);
 const rows=[...new Map([...artworkRows,...diverse,...viewing].map(x=>[x.id,x])).values()].map(decode),enriched=await attachArtwork(db,rows);
 const used=new Set(),seen=Object.fromEntries(['countries','decades','languages','genres'].map(k=>[k,new Map()]));
 const take=(label,count,filter=()=>true,preferArtwork=false)=>{
  const pool=enriched.filter(filter),selected=preferArtwork?choose(pool.filter(x=>x.artwork),count,seed,label,used,seen):[];
  return [...selected,...choose(pool,count-selected.length,seed,label,used,seen)];
 };
 const carousel=take('carousel',4,()=>true,true),history=take('history',4,()=>true,true),featured=take('featured',8),watch=take('watch',4,x=>x.watchable),collection=take('collection',4);
 const selected=[...carousel,...history,...featured,...watch,...collection];
 return {seed,carousel,history,featured,watch,collection,stats:{candidate_count:enriched.length,selected_count:selected.length,artwork_count:selected.filter(x=>x.artwork).length,missing_artwork:selected.filter(x=>!x.artwork).length,missing_metadata:Object.fromEntries(Object.keys(seen).map(k=>[k,selected.filter(x=>!dimensions(x)[k].length).length])),diversity:Object.fromEntries(Object.entries(seen).map(([k,v])=>[k,v.size])),sections:Object.fromEntries(Object.entries({carousel,history,featured,watch,collection}).map(([k,values])=>[k,{ids:values.map(x=>x.id),countries:[...new Set(values.flatMap(x=>dimensions(x).countries))],decades:[...new Set(values.flatMap(x=>dimensions(x).decades))]}]))}};
}
export async function stats(db){const t=Date.now(),base=parse((await one(db,"SELECT value FROM meta WHERE key='counts'"))?.value,{}),live=await one(db,'SELECT count(*) n FROM work'),indexed=await one(db,'SELECT count(*) n FROM search'),art=await one(db,`SELECT count(DISTINCT work_id) approved_artwork FROM artwork_record WHERE ${ARTWORK_WHERE}`),imported=await one(db,'SELECT value FROM publication_import WHERE key=?',['artwork:'+artworkVersion]);return {...base,...await one(db,"SELECT count(*) eligible_sources,count(DISTINCT work_id) watchable_works,count(CASE WHEN watch_state='WATCH_HERE' THEN 1 END) embedded_sources FROM source WHERE checked_ms<=? AND expires_ms>?",[t,t]),...art,ready:Number(live?.n)>0&&Number(indexed?.n)>0,artwork_ready:imported?.value==='DONE',artwork_version:artworkVersion,as_of:new Date(t).toISOString(),snapshot_exported_at:(await one(db,"SELECT value FROM meta WHERE key='exported_at'"))?.value};}
export async function facets(db){
 const countries=(await all(db,'SELECT DISTINCT j.value FROM work w,json_each(w.countries) j ORDER BY j.value')).map(x=>x.value);
 const years=(await all(db,'SELECT DISTINCT year value FROM work WHERE year IS NOT NULL ORDER BY year DESC')).map(x=>x.value);
 const [genres,languages]=await Promise.all(['genres','languages'].map(key=>all(db,`SELECT j.value,COUNT(*) n FROM work_metadata m,json_each(m.payload,'$.${key}') j WHERE typeof(j.value)='text' AND length(trim(j.value))>1 AND lower(j.value) NOT IN ('null','unknown') GROUP BY j.value ORDER BY n DESC,j.value LIMIT 80`)));
 return {countries,years,genres:genres.map(x=>x.value),languages:languages.map(x=>x.value),note:'Genre and language labels are inherited as supplied; normalization is in progress.'};
}
