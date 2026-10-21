#!/usr/bin/env python3
"""Resumable discovery and guarded downloads; never auto-approve identity or rights.

Run release-inventory.mjs first. Discovery uses serial, cached Commons requests.
All metadata and attempts persist in SQLite. A provider failure pauses its queue.
Review requires a separate human/agent decision supported by item-level evidence.
"""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.sites-runtime/release-review.sqlite'
CACHE = ROOT / '.sites-runtime/image-discovery-cache'
HEADERS = {'User-Agent': 'LumetraImageReview/3.0 (https://lumetra-cinema-staging.hardisx9.workers.dev/about)', 'Accept': 'application/json'}
HOSTS = {'commons.wikimedia.org', 'www.wikidata.org', 'upload.wikimedia.org', 'thumb.wikimedia.org', 'www.loc.gov', 'loc.gov', 'ids.si.edu', 'www.si.edu'}
POLICY = {
    'commons': {'terms': 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia', 'api': 'https://www.mediawiki.org/wiki/API:Etiquette', 'rights': 'Per-file license AND exact subject review required'},
    'loc': {'terms': 'https://www.loc.gov/legal/security-copyright-and-privacy/understanding-copyright/', 'rights': 'Per-item rights/access advisory required; online access is not reuse permission'},
    'smithsonian': {'terms': 'https://www.si.edu/openaccess/faq', 'rights': 'CC0-marked assets only; identity and third-party restrictions reviewed'},
    'nfb_canada': {'terms': 'https://help.nfb.ca/terms/', 'rights': 'Written permission required for public display unless a specific applicable grant is established'},
    'bfi_player_free': {'terms': 'https://www.bfi.org.uk/terms-use', 'rights': 'No general permission to reproduce/display images; obtain applicable grant or alternative image'},
}

def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def safe_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None,443):
        raise ValueError('UNAPPROVED_PUBLIC_HTTPS_URL')
    if any(k.lower() in {'token','api_key','key','password','secret'} for k,v in urllib.parse.parse_qsl(parsed.query)):
        raise ValueError('CREDENTIAL_BEARING_URL_REJECTED')
    return parsed

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return None

def public_dns(host):
    addresses = {a[4][0] for a in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError('NON_PUBLIC_DNS_DESTINATION')

def fetch_bytes(url, maximum=3*1024*1024, image=False, timeout=20):
    # The inherited runtime proxy is respected. No direct-access or alternate-IP
    # bypass is attempted when the network or provider denies a request.
    opener = urllib.request.build_opener(NoRedirect())
    for redirect in range(4):
        parsed=safe_url(url)
        # In a managed proxy runtime the proxy performs DNS and host-policy
        # enforcement. Local DNS can be intentionally unavailable. Exact trusted
        # host allowlisting and redirect validation apply in both modes.
        if not urllib.request.getproxies().get('https'):
            public_dns(parsed.hostname)
        try:
            with opener.open(urllib.request.Request(url,headers={**HEADERS,'Accept':'image/jpeg,image/png,image/webp' if image else 'application/json'}),timeout=timeout) as response:
                mime=response.headers.get_content_type()
                if image and mime not in {'image/jpeg','image/png','image/webp'}:
                    raise ValueError('UNSUPPORTED_IMAGE_MIME')
                if int(response.headers.get('Content-Length','0'))>maximum:
                    raise ValueError('ASSET_TOO_LARGE')
                chunks=[];size=0
                while chunk:=response.read(65536):
                    size+=len(chunk)
                    if size>maximum:raise ValueError('ASSET_TOO_LARGE')
                    chunks.append(chunk)
                return b''.join(chunks),{'http_status':response.status,'mime':mime,'final_url':url,'checked_at':timestamp()}
        except urllib.error.HTTPError as e:
            if e.code in (301,302,303,307,308) and redirect<3:
                url=urllib.parse.urljoin(url,e.headers.get('Location',''))
                continue
            raise
    raise ValueError('REDIRECT_LIMIT')

def cached_json(url, timeout=20):
    safe_url(url)
    CACHE.mkdir(parents=True,exist_ok=True)
    path=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    if path.exists():return json.loads(path.read_text()),str(path.relative_to(ROOT))
    raw,check=fetch_bytes(url,timeout=timeout)
    result=json.loads(raw)
    if result.get('error'):raise ValueError('API_'+str(result['error'].get('code')))
    path.write_text(json.dumps({'response':result,'check':check},ensure_ascii=False))
    return {'response':result,'check':check},str(path.relative_to(ROOT))

def query_url(query,provider):
    if provider=='commons':
        params={'action':'query','format':'json','formatversion':'2','maxlag':'5','generator':'search','gsrnamespace':'6','gsrsearch':query+' filetype:bitmap','gsrlimit':'8','prop':'imageinfo','iiprop':'url|size|mime|extmetadata|sha1'}
        return 'https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(params)
    if provider=='loc':return 'https://www.loc.gov/pictures/?'+urllib.parse.urlencode({'fo':'json','c':'8','q':query})
    raise ValueError('PROVIDER_ADAPTER_NOT_CONFIGURED')

def discover(limit,provider):
    db=sqlite3.connect(STATE);db.row_factory=sqlite3.Row
    hold=db.execute('SELECT * FROM provider_checkpoint WHERE provider=?',(provider,)).fetchone()
    if hold and hold['not_before']>timestamp():
        print(json.dumps({'provider':provider,'status':'PAUSED','reason':hold['reason'],'not_before':hold['not_before']}));return 2
    rows=db.execute("SELECT q.*,s.subject_type FROM acquisition_queue q JOIN image_subject s USING(canonical_subject_id) WHERE q.status IN ('QUEUED','RETRY') ORDER BY CASE s.subject_type WHEN 'technology' THEN 0 WHEN 'camera-milestone' THEN 1 WHEN 'crew-role' THEN 2 WHEN 'film' THEN 3 ELSE 4 END,q.canonical_subject_id LIMIT ?",(limit,)).fetchall()
    done=0
    for row in rows:
        subject=row['canonical_subject_id'];start=timestamp()
        try:
            envelope,evidence=cached_json(query_url(row['search_query'],provider));result=envelope['response']
            pages=result.get('query',{}).get('pages',[]) if provider=='commons' else result.get('results',[])
            for page in pages:
                info=(page.get('imageinfo') or [{}])[0] if provider=='commons' else page
                url=info.get('url') or (page.get('image_url') or [None])[0]
                source=info.get('descriptionurl') or page.get('id')
                identifier=hashlib.sha256(json.dumps([subject,source,url],sort_keys=True).encode()).hexdigest()
                db.execute('INSERT OR IGNORE INTO image_candidate VALUES(?,?,?,?,?,?,?)',(identifier,subject,url,source,provider,'IDENTITY_AND_RIGHTS_REVIEW_REQUIRED',json.dumps({'page':page,'metadata_evidence':evidence,'policy':POLICY[provider]},ensure_ascii=False)))
            outcome='CANDIDATES_RECORDED' if pages else 'NO_RESULTS_FOR_THIS_QUERY'
            db.execute('INSERT INTO acquisition_attempt(canonical_subject_id,provider,attempted_at,http_status,outcome,evidence_path) VALUES(?,?,?,?,?,?)',(subject,provider,start,200,outcome,evidence))
            db.execute("UPDATE acquisition_queue SET status='REVIEW_REQUIRED',provider=?,attempts=attempts+1,last_error=NULL WHERE canonical_subject_id=?",(provider,subject));db.commit();done+=1
            print(json.dumps({'subject':subject,'candidates':len(pages),'status':outcome}),flush=True)
            time.sleep(1.5)
        except Exception as exc:
            # Pause the provider on access/network failure rather than sending
            # tens of thousands of doomed requests or labelling subjects absent.
            reason=f'{type(exc).__name__}: {exc}'
            status=getattr(exc,'code',None)
            db.execute('INSERT INTO acquisition_attempt(canonical_subject_id,provider,attempted_at,http_status,outcome,error_reason) VALUES(?,?,?,?,?,?)',(subject,provider,start,status,'PROVIDER_FAILURE',reason))
            db.execute("UPDATE acquisition_queue SET status='RETRY',provider=?,attempts=attempts+1,last_error=? WHERE canonical_subject_id=?",(provider,reason,subject))
            until=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=30)).isoformat()
            db.execute('INSERT OR REPLACE INTO provider_checkpoint VALUES(?,?,?)',(provider,until,reason));db.commit()
            print(json.dumps({'provider':provider,'status':'PAUSED','reason':reason,'completed_in_run':done}),flush=True);return 2
    return 0

def download(candidate_id):
    db=sqlite3.connect(STATE);db.row_factory=sqlite3.Row
    row=db.execute('SELECT * FROM image_candidate WHERE candidate_id=?',(candidate_id,)).fetchone()
    if not row:raise ValueError('UNKNOWN_CANDIDATE')
    metadata=json.loads(row['metadata_json']);review=metadata.get('review',{})
    required=['identity_evidence','reviewer','review_timestamp','license','license_url','creator','credit']
    if not all(review.get(k) for k in required) or review.get('approved') is not True:
        raise ValueError('EXPLICIT_ITEM_IDENTITY_AND_RIGHTS_REVIEW_REQUIRED')
    raw,check=fetch_bytes(row['candidate_url'],maximum=16*1024*1024,image=True)
    from io import BytesIO
    from PIL import Image
    with Image.open(BytesIO(raw)) as im:
        if im.width*im.height>80_000_000:raise ValueError('DECODED_IMAGE_TOO_LARGE')
        if im.format not in {'JPEG','PNG','WEBP'}:raise ValueError('IMAGE_SIGNATURE_MISMATCH')
        ext={'JPEG':'jpg','PNG':'png','WEBP':'webp'}[im.format];size=im.size;im.verify()
    digest=hashlib.sha256(raw).hexdigest();path=ROOT/'public/photos'/f'{digest}.{ext}';path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    db.execute("UPDATE image_registry SET source_page=?,source_provider=?,creator=?,credit=?,license_or_permission=?,reuse_conditions=?,download_or_embed='LOCAL',local_asset_path=?,image_hash=?,dimensions=?,identity_evidence=?,reviewer=?,review_timestamp=?,last_http_check=?,browser_render_check='NOT_RUN',status='VERIFIED_LICENSED_LOCAL',error_reason=NULL WHERE canonical_subject_id=?",(row['source_page'],row['source_provider'],review['creator'],review['credit'],review['license'],review['license_url'],str(path.relative_to(ROOT)),digest,f'{size[0]}x{size[1]}',review['identity_evidence'],review['reviewer'],review['review_timestamp'],json.dumps(check),row['canonical_subject_id']));db.commit()
    print(json.dumps({'subject':row['canonical_subject_id'],'path':str(path.relative_to(ROOT)),'sha256':digest,'browser_render_check':'NOT_RUN'}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider',choices=['commons','loc'],default='commons')
    parser.add_argument('--limit',type=int,default=100)
    parser.add_argument('--download-reviewed-candidate')
    args=parser.parse_args()
    if args.limit<1 or args.limit>50000:parser.error('limit must be 1..50000')
    raise SystemExit(download(args.download_reviewed_candidate) if args.download_reviewed_candidate else discover(args.limit,args.provider))
