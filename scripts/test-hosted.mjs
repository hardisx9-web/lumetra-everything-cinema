import assert from 'node:assert/strict';
import {openCatalogue,importCatalogue} from './local-catalogue.mjs';
import {initialize,query,dossier,stats,facets} from '../site-server/catalogue.js';
const {sqlite,db,assets}=openCatalogue(),steps=await importCatalogue(db,assets),s=await stats(db);
assert.equal(s.works,20512);assert.equal(s.source_records,23711);assert.equal(s.embedded_sources,0);
// Expiring evidence is checked at the actual test time, never made fresh by a fixture date.
const current=sqlite.prepare('SELECT count(*) sources,count(DISTINCT work_id) works FROM source WHERE checked_ms<=? AND expires_ms>?').get(Date.now(),Date.now());
assert.equal(s.eligible_sources,current.sources);assert.equal(s.watchable_works,current.works);
const r=await query(db,new URLSearchParams('q=moon'));assert.equal(r.total,27);assert.equal(r.items.length,24);
const f=await query(db,new URLSearchParams('q=moon&country=France&year=1902'));assert.equal(f.total,1);const detail=await dossier(db,f.items[0].id);assert(detail.evidence.length>0);assert(detail.artwork);
assert((await facets(db)).years.includes(2026));await assert.rejects(query(db,new URLSearchParams('page=0')));
assert((await query(db,new URLSearchParams('q='+'film '.repeat(25)))).total>=0);
assert((await initialize(db,assets)).ready);
console.log(JSON.stringify({pass:true,steps,counts:s,search:r.total,dossier:detail.title}));sqlite.close();
