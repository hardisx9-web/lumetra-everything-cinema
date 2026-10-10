import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
export function openCatalogue(filename=':memory:'){
 if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true});
 const sqlite=new DatabaseSync(filename);
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_schema_migration (name TEXT PRIMARY KEY)');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())if(!sqlite.prepare('SELECT 1 FROM local_schema_migration WHERE name=?').get(file)){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync('drizzle/'+file,'utf8'));sqlite.prepare('INSERT INTO local_schema_migration(name) VALUES(?)').run(file);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
 }
 const db={prepare(sql){return {sql,args:[],bind(...args){if(args.length>100)throw Error('D1 100-bind limit exceeded');this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.args)};},async run(){return sqlite.prepare(sql).run(...this.args);}};},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>sqlite.prepare(s.sql).run(...s.args));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const assets={async fetch(request){try{return new Response(readFileSync(resolve('public','.'+new URL(request.url).pathname)));}catch{return new Response('Not found',{status:404});}}};
 return {sqlite,db,assets};
}
export async function importCatalogue(db,assets){const {initialize}=await import('../site-server/catalogue.js');for(let step=0;step<300;step++){if((await initialize(db,assets)).ready)return step+1;}throw Error('Catalogue import did not finish');}
