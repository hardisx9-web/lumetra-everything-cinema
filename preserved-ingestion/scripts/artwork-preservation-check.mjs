import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.chdir(resolve(import.meta.dirname,'../..'));
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'lumetra-artwork-preservation-check'});
try{await c.connect();await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const before=JSON.parse(await readFile('docs/artwork-preservation-baseline.json','utf8')),after={as_of:new Date().toISOString(),tables:{}};
 for(const [table,key] of Object.entries({work:'work_id',playback_source:'source_id',ingest_candidate:'candidate_id',source_verification:'verification_id',ingest_run:'run_id',media_asset:'asset_id'})){
 const expr=table==='media_asset'?"jsonb_build_array(asset_id,work_id,asset_type,canonical_url,usage_basis,license_verified,attribution,source_id,metadata,created_at)::text":"row_to_json(t)::text";
 const filter=table==='media_asset'?" WHERE source_id<>'WIKIMEDIA_COMMONS'":'';
 after.tables[table]=(await c.query(`SELECT count(*)::integer n,md5(string_agg(${expr},'|' ORDER BY ${key})) digest FROM ${table} t${filter}`)).rows[0];
 assert.deepEqual(after.tables[table],before.tables[table],table+' historical records changed');
 }
 after.originals_unchanged=true;after.note='Media checksum includes every original column of all 14,470 original institution assets; new Commons rows excluded. Other five tables are whole-row checksums.';
 await c.query('COMMIT');await writeFile('docs/artwork-preservation-final.json',JSON.stringify(after,null,2)+'\n');console.log(JSON.stringify(after));
}finally{await c.end();}
