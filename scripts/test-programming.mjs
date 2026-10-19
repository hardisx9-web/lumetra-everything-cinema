import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {openCatalogue,importCatalogue} from './local-catalogue.mjs';
import {DatabaseSync} from 'node:sqlite';
import {artworkVersion} from '../site-server/artwork-version.js';
import {programmeCountries} from '../site-server/programming-dimensions.js';
import {programming,query,dossier,stats,initialize,attachArtwork} from '../site-server/catalogue.js';
import {api} from '../site-server/handler.js';
const {sqlite,db,assets}=openCatalogue();
const steps=await importCatalogue(db,assets);
const manifest=JSON.parse(readFileSync('public/publication/artwork-manifest.json'));
assert.equal((await stats(db)).approved_artwork,manifest.works);
const oldRows=sqlite.prepare('SELECT * FROM source ORDER BY source_id').all();
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
const sections=['carousel','history','featured','watch','collection'];const ids=p=>sections.flatMap(s=>p[s].map(w=>w.id));
await test('real PostgreSQL export survives D1 import with licensing + local images',async()=>{
 const r=await query(db,new URLSearchParams('artwork=1'));assert.equal(r.total,manifest.works);assert(r.items.length>4);
 for(const w of r.items){assert.equal(w.artwork.work_id,w.id);assert(w.artwork.license_url.startsWith('https://'));assert(readFileSync('public'+w.artwork.url).length>100);assert(w.artwork.width>0);}
});
await test('unreviewed, unhealthy or unlicensed artwork fails closed',async()=>{
 const id='bad-test';sqlite.prepare("INSERT INTO artwork_record(id,entity_id,work_id,image_url,source_url,license,attribution) VALUES(?,?,?,?,?,?,?)").run(id,'work-act-of-killing','work-act-of-killing','/missing.jpg','https://example.test','UNKNOWN','unknown');
 const r=await attachArtwork(db,[{id:'work-act-of-killing'}]);assert(!r[0].artwork);sqlite.prepare('DELETE FROM artwork_record WHERE id=?').run(id);
});
const first=await programming(db,new URLSearchParams('seed=2026-10-08-sessionA'));
await test('same session produces identical unique programme across sections',async()=>{assert.deepEqual(first,await programming(db,new URLSearchParams('seed=2026-10-08-sessionA')));assert.equal(ids(first).length,new Set(ids(first)).size);assert.equal(first.carousel.length,4);assert(first.carousel.every(w=>w.artwork));assert(first.watch.every(w=>w.watchable));});
await test('session/day/reshuffle seeds rotate real Works',async()=>{for(const seed of ['2026-10-08-sessionB','2026-10-09-sessionA','reshuffle-42'])assert.notDeepEqual(ids(first),ids(await programming(db,new URLSearchParams({seed}))));await assert.rejects(programming(db,new URLSearchParams('seed='+ 'x'.repeat(81))));});
await test('country and decade diversity with explicit metadata gaps',()=>{assert(first.stats.diversity.countries>1);assert(first.stats.diversity.decades>3);assert('languages' in first.stats.missing_metadata);});
await test('search and dossier return identical provenance',async()=>{const q=await query(db,new URLSearchParams('q=Pather'));const w=q.items.find(w=>w.id==='work-pather-panchali');assert(w?.artwork);const d=await dossier(db,w.id);assert.deepEqual(w.artwork,d.artwork);assert(d.evidence.length);});
await test('existing API validation/counts and source states preserved',async()=>{const s=await stats(db);assert.equal(s.works,20512);assert.equal(s.source_records,23711);assert.equal(s.embedded_sources,0);assert.deepEqual(sqlite.prepare('SELECT * FROM source ORDER BY source_id').all(),oldRows);const res=await api(new Request('http://localhost/api/films?q=moon&country=France&year=1902'),{DB:db,ASSETS:assets});assert.equal(res.status,200);assert.equal((await res.json()).total,1);await assert.rejects(query(db,new URLSearchParams('page=0')));});
await test('artwork seed resumes and runs again without duplicates',async()=>{const before=sqlite.prepare('SELECT count(*) n FROM artwork_record').get().n;assert((await initialize(db,assets)).ready);assert.equal(sqlite.prepare('SELECT count(*) n FROM artwork_record').get().n,before);});
await test('additive migration preserves populated catalogue and prior artwork',()=>{
 const old=new DatabaseSync(':memory:');old.exec(readFileSync('drizzle/0000_swift_centennial.sql','utf8'));old.exec(readFileSync('drizzle/0001_vengeful_gabe_jones.sql','utf8'));
 old.prepare('INSERT INTO work(id,title) VALUES(?,?)').run('work-protected','Protected');old.prepare('INSERT INTO artwork_record(id,entity_id,image_url,source_url,license,attribution) VALUES(?,?,?,?,?,?)').run('art-protected','work-protected','/old.jpg','https://example.test','Unverified','Legacy');
 old.exec(readFileSync('drizzle/0002_artwork_enrichment.sql','utf8'));assert.equal(old.prepare('SELECT title FROM work').get().title,'Protected');assert.equal(old.prepare('SELECT license,review_status FROM artwork_record').get().license,'Unverified');assert.equal(old.prepare('SELECT review_status FROM artwork_record').get().review_status,'PENDING_REVIEW');old.close();
});
await test('an old catalogue gets new artwork; interrupted assets do not become DONE',async()=>{
 sqlite.prepare('DELETE FROM publication_import WHERE key=?').run('artwork:'+artworkVersion);
 sqlite.prepare("INSERT OR REPLACE INTO publication_import(key,value) VALUES('artwork_cursor','DONE')").run();
 await assert.rejects(initialize(db,{fetch:async()=>new Response('temporary',{status:503})}));
 assert.equal((await stats(db)).artwork_ready,false);
 const start=await initialize(db,assets);assert.equal(start.ready,false);assert.equal(start.artwork_progress,1);
 await importCatalogue(db,assets);assert.equal((await stats(db)).artwork_ready,true);assert.deepEqual(sqlite.prepare('SELECT * FROM source ORDER BY source_id').all(),oldRows);
});
await test('translated country labels do not inflate diversity',()=>assert.deepEqual(programmeCountries(['France','Frankrijk','USA','United States','Verenigde Staten']),['France','United States']));
writeFileSync('docs/artwork-programming-tests.json',JSON.stringify({passed,failed:0,steps,programme:first.stats,programme_ids:ids(first),catalogue:await stats(db)},null,2)+'\n');sqlite.close();console.log(JSON.stringify({passed,failed:0}));
