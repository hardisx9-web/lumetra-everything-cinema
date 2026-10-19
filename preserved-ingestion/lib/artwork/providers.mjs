import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const cache=resolve(import.meta.dirname,'../../../.sites-runtime/artwork-cache');
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const digest=value=>createHash('sha256').update(value).digest('hex');
const last=new Map();
const USER_AGENT='LumetraArtwork/2.0 (+https://lumetra-everything-cinema.ashiaslmm.chatgpt.site/about; film artwork research)';
export async function request(url,{binary=false,delay=6500,client}={}) {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password)throw Error('HTTPS_PUBLIC_URL_REQUIRED');
  if(binary&&!['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname))throw Error('UNAPPROVED_IMAGE_HOST');
  const key=digest(url),path=resolve(cache,key+(binary?'.image':'.json'));
  try {const data=await readFile(path);return binary?data:JSON.parse(data);}catch{}
  const provider=u.hostname;
  if(client){const row=(await client.query('SELECT not_before FROM artwork_provider_checkpoint WHERE provider=$1',[provider])).rows[0];if(row?.not_before>new Date())throw Object.assign(Error('PROVIDER_COOLDOWN'),{pause:true,until:row.not_before});}
  await sleep(Math.max(0,(last.get(provider)||0)+delay-Date.now()));last.set(provider,Date.now());
  const res=await fetch(url,{headers:{'User-Agent':USER_AGENT,Accept:binary?'image/jpeg,image/png,image/webp':'application/json'},signal:AbortSignal.timeout(30000)});
  const wait=async reason=>{const retry=res.headers.get('retry-after');const seconds=Math.max(60,Number(retry)||Math.ceil((Date.parse(retry)-Date.now())/1000)||0),until=new Date(Date.now()+seconds*1000);if(client)await client.query(`INSERT INTO artwork_provider_checkpoint(provider,not_before,reason) VALUES($1,$2,$3) ON CONFLICT(provider) DO UPDATE SET not_before=EXCLUDED.not_before,reason=EXCLUDED.reason,updated_at=NOW()`,[provider,until,reason]);await res.body?.cancel();throw Object.assign(Error(reason),{pause:true,until});};
  if([429,503].includes(res.status))return wait('HTTP_'+res.status);
  if([401,403].includes(res.status)){await res.body?.cancel();throw Object.assign(Error('SOURCE_ACCESS_BLOCKED_'+res.status),{pause:true});}
  if(!res.ok){await res.body?.cancel();throw Error('HTTP_'+res.status);}
  const max=binary?16*1024*1024:3*1024*1024;
  if(Number(res.headers.get('content-length'))>max){await res.body?.cancel();throw Error('RESPONSE_TOO_LARGE');}
  if(binary&&!/^image\/(jpeg|png|webp)/i.test(res.headers.get('content-type')||'')){await res.body?.cancel();throw Error('NOT_AN_IMAGE');}
  let size=0;const chunks=[];for await(const chunk of res.body){size+=chunk.length;if(size>max)throw Error('RESPONSE_TOO_LARGE');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),data=binary?bytes:JSON.parse(bytes.toString());
  if(data?.error){if(data.error.code==='maxlag')return wait('MAXLAG');throw Error(data.error.code);}
  await mkdir(cache,{recursive:true});await writeFile(path,bytes);
  return data;
}
export async function commonsSearch(work,client) {
  const titles=[work.metadata?.displayTitle,work.canonical_title,work.original_title,...(work.alternate_titles||[])].filter(Boolean);
  const title=titles.find(t=>/[a-zA-Z]{3}/.test(t))||titles[0];
  const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',maxlag:'5',generator:'search',gsrnamespace:'6',gsrsearch:`"${title.replaceAll('"','')}" ${work.year||''} filetype:bitmap`,gsrlimit:'12',prop:'imageinfo',iiprop:'url|size|mime|extmetadata|sha1'});
  const data=await request('https://commons.wikimedia.org/w/api.php?'+params,{client});return data.query?.pages||[];
}
export async function commonsFiles(files,client) {
  const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',maxlag:'5',titles:files.map(f=>'File:'+f).join('|'),prop:'imageinfo',iiprop:'url|size|mime|extmetadata|sha1'});
  return (await request('https://commons.wikimedia.org/w/api.php?'+params,{client})).query?.pages||[];
}
// LOC is a separate discovery adapter. Item-level rights + reviewed identity are
// required before publication; a collection membership is not a rights grant.
export async function locSearch(work,client) {
  const p=new URLSearchParams({fo:'json',c:'10',q:`${work.canonical_title} ${work.year||''}`});
  return (await request('https://www.loc.gov/pictures/?'+p,{delay:6500,client})).results||[];
}
export async function europeanaSearch(work,client) {
  if(!process.env.EUROPEANA_API_KEY)throw Error('EUROPEANA_KEY_REQUIRED');
  // Never persist the credential-bearing request URL in provenance or logs.
  const p=new URLSearchParams({wskey:process.env.EUROPEANA_API_KEY,query:`title:"${work.canonical_title.replaceAll('"','')}"`,reusability:'open',rows:'12'});
  return (await request('https://api.europeana.eu/record/v2/search.json?'+p,{client})).items||[];
}
