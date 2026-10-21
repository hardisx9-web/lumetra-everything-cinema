import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openCatalogue,importCatalogue} from './local-catalogue.mjs';
import {query} from '../site-server/catalogue.js';
import {api} from '../site-server/handler.js';
import {shellMetadata,securityHeaders} from '../site-server/seo.js';

const {sqlite,db,assets}=openCatalogue();await importCatalogue(db,assets);
test('credit profile exact director filter agrees with database and handles title collisions',async()=>{
 const name='Georges Méliès';const expected=sqlite.prepare('SELECT count(*) n FROM work WHERE director=?').get(name).n;
 const result=await query(db,new URLSearchParams({director:name,limit:'48'}));
 assert.equal(result.total,expected);assert.ok(result.items.every(f=>f.director===name));
 await assert.rejects(query(db,new URLSearchParams({director:'x'.repeat(501)})));
});
test('API methods, origin and correction throttling are enforced',async()=>{
 assert.equal((await api(new Request('https://test.invalid/api/films',{method:'POST'}),{DB:db,ASSETS:assets})).status,405);
 const body=JSON.stringify({page:'https://example.org/film/test',evidence:'https://example.org/evidence',message:'A test-only correction with evidence for integration verification.',website:''});
 const req=origin=>new Request('https://test.invalid/api/corrections',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});
 assert.equal((await api(req('https://other.invalid'),{DB:db})).status,403);
 for(let i=0;i<10;i++)assert.equal((await api(req('https://test.invalid'),{DB:db})).status,201);
 assert.equal((await api(req('https://test.invalid'),{DB:db})).status,429);
});
test('server metadata uses exact record fields and canonical path without query duplicates',async()=>{
 const shell=new Response(readFileSync('public/shell.html','utf8'));
 const html=await shellMetadata(new Request('https://review.invalid/film/work-trip-to-the-moon?tracking=1'),shell,db);
 assert.match(html,/<title>Le Voyage dans la Lune \(1902\) — Lumetra<\/title>/);
 assert.match(html,/href="https:\/\/review.invalid\/film\/work-trip-to-the-moon"/);
 assert.match(html,/name="robots" content="noindex,follow"/);
 assert.doesNotMatch(html,/<title>.*tracking=1/);
});
test('server metadata escapes untrusted credit text and headers disable unused sensitive APIs',async()=>{
 const html=await shellMetadata(new Request('https://review.invalid/person/%3Cscript%3Eevil%3C%2Fscript%3E'),new Response(readFileSync('public/shell.html','utf8')),db);
 assert.doesNotMatch(html,/<title><script>/);assert.match(html,/&lt;script&gt;/);
 const headers=securityHeaders();assert.equal(headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');assert.match(headers.get('Permissions-Policy'),/camera=\(\)/);
});
test('review robots prevent indexing and sitemap retains real catalogue paths',()=>{
 assert.match(readFileSync('public/robots.txt','utf8'),/Disallow: \//);
 const sitemap=readFileSync('public/sitemap.xml','utf8');assert.match(sitemap,/\/film\/work-trip-to-the-moon/);assert.doesNotMatch(sitemap,/\/my-cinema</);
});
test.after(()=>sqlite.close());
