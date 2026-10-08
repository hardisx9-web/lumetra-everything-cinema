import { verifyCandidate } from '../lib/ingestion/verification.mjs';
import { parseJson, SourceAccessError, SourceHttp, digest } from '../lib/ingestion/http.mjs';

// Health checks use the same provider-specific complete-film proof as ingestion.
// They never inherit a legacy assertion or treat a player marker/HTTP 200 as a pass.
export async function inspectProvider(source, fetchPage, now = new Date(), sharedHttp = new SourceHttp()) {
  if (source.availability_expiry_if_known && new Date(source.availability_expiry_if_known) <= now)
    return {status:'FAIL',reason:'availability-expired',evidence:[],httpStatus:null};
  let url;
  try {url=new URL(source.canonical_source_url);} catch {return {status:'FAIL',reason:'invalid-url',evidence:[],httpStatus:null};}
  if(url.protocol!=='https:')return {status:'PENDING',reason:'untrusted-protocol',evidence:[],httpStatus:null};
  // A test/operator transport can be injected; all proof logic remains the real verifier.
  const http=fetchPage ? {
    async request(target,options={}) {
      const response=await fetchPage(target,{...options,timeoutMs:12000});
      if(!response.ok)throw new SourceAccessError([401,403,429].includes(response.status)?'SOURCE_ACCESS_BLOCKED':'SOURCE_UNAVAILABLE',new URL(target).origin+new URL(target).pathname,response.status,response.error||`HTTP ${response.status}`);
      return {body:response.body,url:response.finalUrl||target,status:response.status,headers:response.headers||{},sha256:digest(response.body||'')};
    },
    async json(target,options={}){const doc=await this.request(target,options);return {...doc,data:parseJson(doc.body)};},
  } : sharedHttp;
  const registry=source.registry_json||{id:source.registry_source_id,name:source.source_owner||source.registry_source_id,embed_policy:source.embed_status==='PROHIBITED'?'EXTERNAL_ONLY':'NEEDS_CURRENT_TERMS_AUDIT'};
  const candidate=source.candidate_json||{...source.metadata,registry_source_id:source.registry_source_id,source_url:source.canonical_source_url,title:source.metadata?.title,runtime:source.runtime};
  const record=await verifyCandidate(registry,candidate,http);
  const allowed=record.full_film_verified&&record.free_verified&&record.official_or_rights_verified&&record.live_check_status==='PASS';
  const reason=record.http_status===404||record.http_status===410?'detail-gone':record.error_code==='SOURCE_RESPONSE_NOT_JSON'?'invalid-player-config':record.error_code|| (allowed?'provider-complete-film-confirmed':'provider-evidence-incomplete');
  return {status:allowed?'PASS':record.live_check_status==='FAIL'?'FAIL':'PENDING',reason,evidence:record.verification_evidence,httpStatus:record.http_status??null,record};
}
