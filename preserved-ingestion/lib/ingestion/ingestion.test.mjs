import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateSource } from './catalogues.mjs';
import { absolute, checkHls, parseJson, SourceAccessError } from './http.mjs';
import { verifyCandidate } from './verification.mjs';
import { deriveWatchState } from '../../src/data/source-model.js';

const source = (id) => ({ id, name: id, embed_policy: 'EXTERNAL_ONLY' });
const film = (id) => ({ id, work_id: id, category: 'film', title: `Film ${id}`, year: 1960, duration: 600, directors: [{first_name:'A',last_name:'Director'}], availability: {is_public:true,resource_url:`https://www.nfb.ca/film/${id}/`} });

test('NFB traverses every advertised page; no film-count cap', async () => {
  const calls = [];
  const result = await enumerateSource(source('nfb_canada'), { json: async (url) => { const page = Number(new URL(url).searchParams.get('page')); calls.push(page); return {data:{items:[film(page)],meta:{pagination:{total:4,pages:4}}}}; } });
  assert.deepEqual(calls,[1,2,3,4]); assert.equal(result.candidates.length,4); assert.equal(result.enumeration_complete,true);
});
test('partial discovery survives access denial, no false enumeration completion', async () => {
  let calls=0;
  const result=await enumerateSource(source('nfb_canada'),{json:async()=>{if(++calls===2)throw new SourceAccessError('SOURCE_ACCESS_BLOCKED','https://publicapi.nfb.ca/api/v5/works',403);return{data:{items:[film(1)],meta:{pagination:{total:4,pages:4}}}};}});
  assert.equal(result.candidates.length,1);assert.equal(result.status,'SOURCE_ACCESS_BLOCKED');assert.equal(result.enumeration_complete,false);
});
test('repeated and premature-empty pages fail closed, retaining discovery', async () => {
  const repeated=await enumerateSource(source('nfb_canada'),{json:async()=>({data:{items:[film(1)],meta:{pagination:{total:4,pages:4}}}})});
  assert.equal(repeated.status,'SOURCE_PAGINATION_ERROR');assert.equal(repeated.candidates.length,1);
  let n=0;const empty=await enumerateSource(source('nfb_canada'),{json:async()=>({data:{items:++n===1?[film(1)]:[],meta:{pagination:{total:4,pages:4}}}})});
  assert.equal(empty.enumeration_complete,false);assert.equal(empty.candidates.length,1);
});
test('LOC follows documented next pagination even when server caps page size below requested 1000', async () => {
  let n=0;const result=await enumerateSource(source('loc_national_screening_room'),{json:async()=>({data:{results:[{id:++n,title:`Film ${n}`,url:`https://www.loc.gov/item/${n}/`}],pagination:{total:3,next:n<3?`page${n+1}`:null}}})});
  assert.equal(n,3);assert.equal(result.enumeration_complete,true);
});
test('UNAM prefixed REST JSON is accepted only at actual array suffix; missing images stay null', () => {
  assert.equal(parseJson('<p>broken WordPress prefix</p>[{"id":1}]')[0].id,1);
  assert.throws(()=>parseJson('<p>not REST</p>'));
  assert.equal(absolute(undefined,'https://example.org/'),null);assert.equal(absolute('','https://example.org/'),null);
  assert.equal(absolute('http://insecure.example/','https://example.org/'),null);
});
test('missing YouTube credentials are explicit, not a successful empty catalogue', async () => {
  const saved=process.env.YOUTUBE_API_KEY;delete process.env.YOUTUBE_API_KEY;
  try {const result=await enumerateSource(source('saina_movies'),{});assert.equal(result.status,'SOURCE_API_CREDENTIAL_REQUIRED');assert.equal(result.enumeration_complete,false);}
  finally {if(saved!==undefined)process.env.YOUTUBE_API_KEY=saved;}
});
test('HTTP 200 + iframe does not establish live film, paid content and fragments cannot pass', async () => {
  const candidate={title:'Example',source_url:'https://www.cinematheque.fr/henri/film/1/',runtime:10,year:1960,director_credit:'Director'};
  const http={request:async(url)=>({status:200,url,body:'<h1>Example</h1><iframe src="https://player.vimeo.com/video/123"></iframe>',sha256:'fixture'}),json:async()=>({data:{video:{id:123,duration:600},request:{files:{hls:{cdns:{}}}}}})};
  const record=await verifyCandidate(source('cinematheque_henri'),candidate,http);
  assert.equal(record.watch_state,'NO_VERIFIED_FREE_STREAM');assert.equal(record.live_check_status,'PENDING');
  assert.ok(record.verification_evidence.some((item)=>item.kind==='CHECK_ERROR'));
  const payment=await verifyCandidate(source('35mm_online'),{...candidate,source_url:'https://35mm.online/vod/fabula/example',raw:{isSubscription:true,prices:{price:'7,99 zł'}}},{});
  assert.equal(payment.lifecycle_status,'REJECTED');assert.equal(payment.free_verified,false);
  const fragment=await verifyCandidate(source('cinematheque_henri'),{...candidate,incomplete:true},{});
  assert.equal(fragment.lifecycle_status,'REJECTED');assert.equal(fragment.full_film_verified,false);
});
test('HLS needs complete matching duration and an accessible media segment, not merely a route 200', async () => {
  const request=async(url,options={})=>url.endsWith('.ts')?{status:200,headers:{'content-length':'100','content-type':'video/mp2t'},url}:{status:200,body:'#EXTM3U\n#EXTINF:60,\nfilm.ts\n#EXT-X-ENDLIST\n',sha256:'fixture',url};
  const pass=await checkHls({request},'https://cdn.example/film.m3u8',1);assert.equal(pass.verified,true);
  assert.equal((await checkHls({request},'https://cdn.example/film.m3u8',10)).verified,false);
  assert.equal((await checkHls({request},'https://cdn.example/film.m3u8',null)).verified,false);
  assert.equal((await checkHls({request:async(url)=>({status:200,body:'<h1>Not a film</h1>',url})},'https://cdn.example/film.m3u8',1)).verified,false);
});
test('freshness/expiry and genuinely working embed are mandatory even with a claimed watch label', () => {
  const now=Date.now();const record={full_film_verified:true,free_verified:true,official_or_rights_verified:true,live_check_status:'PASS',canonical_source_url:'https://provider.example/film',external_watch_url:'https://provider.example/film',last_checked_at:new Date(now-1000).toISOString(),embed_status:'PERMITTED',embed_url_if_allowed:'https://provider.example/embed',embed_working:false};
  assert.equal(deriveWatchState(record,now),'WATCH_FREE_EXTERNALLY');
  assert.equal(deriveWatchState({...record,embed_working:true},now),'WATCH_HERE');
  assert.equal(deriveWatchState({...record,free_verified:false,watch_state:'WATCH_HERE'},now),'NO_VERIFIED_FREE_STREAM');
  assert.equal(deriveWatchState({...record,last_checked_at:new Date(now-8*86400000).toISOString()},now),'NO_VERIFIED_FREE_STREAM');
  assert.equal(deriveWatchState({...record,availability_expiry_if_known:new Date(now-1000).toISOString()},now),'NO_VERIFIED_FREE_STREAM');
});
