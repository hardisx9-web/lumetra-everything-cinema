import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const origin=process.env.PUBLIC_SITE_ORIGIN;
if(!origin||new URL(origin).protocol!=='https:')throw Error('Set the verified HTTPS PUBLIC_SITE_ORIGIN; no invented deployment origin is used.');
const database=new DatabaseSync('.sites-runtime/release-review.sqlite',{readOnly:true});
const pages=database.prepare('SELECT DISTINCT page_url FROM image_requirement').all().map(r=>r.page_url);
const urls=[...new Set([...pages,'/about','/attributions','/corrections','/museum','/world','/journal'])].filter(p=>p!=='/my-cinema').sort();
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
writeFileSync('public/sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(p=>`<url><loc>${xml(new URL(p,origin).href)}</loc></url>`).join('\n')+'\n</urlset>');
// Review deployment stays out of search engines until the release gates pass.
writeFileSync('public/robots.txt','User-agent: *\nDisallow: /\n# Private predeployment review: indexing remains disabled until owner-approved release.\n');
console.log(JSON.stringify({origin,urls:urls.length,indexing:'DISABLED_FOR_REVIEW'}));
