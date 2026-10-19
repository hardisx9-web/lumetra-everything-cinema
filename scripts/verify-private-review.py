#!/usr/bin/env python3
"""HTTP/API verification using an existing Site-scoped service token on stdin.
No token is printed, stored or transmitted to any other origin. Not browser QA.
"""
import hashlib
import json
from pathlib import Path
import sys
import termios
import time
import urllib.error
import urllib.parse
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

if sys.stdin.isatty():
    attr=termios.tcgetattr(sys.stdin.fileno());attr[3]&=~termios.ECHO;termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,attr)
print('Ready for private review access JSON on stdin (input hidden).',flush=True)
config=json.loads(sys.stdin.readline())
origin=config['origin'].rstrip('/')
if urllib.parse.urlsplit(origin).hostname!='lumetra-predeployment-review-20261019.ashiaslmm.chatgpt.site':raise ValueError('Unexpected review origin')
token=config['token'];opener=urllib.request.build_opener(NoRedirect())
checks=[]
def request(path,method='GET'):
    url=origin+path
    headers={'OAI-Sites-Authorization':'Bearer '+token,'Origin':origin}
    start=time.monotonic()
    with opener.open(urllib.request.Request(url,headers=headers,method=method,data=b'' if method=='POST' else None),timeout=25) as response:
        data=response.read(16*1024*1024);info={'path':path,'method':method,'http_status':response.status,'mime':response.headers.get('Content-Type'),'bytes':len(data),'elapsed_ms':round((time.monotonic()-start)*1000,2),'sha256':hashlib.sha256(data).hexdigest()}
        checks.append(info);return data,info
report={'scope':'Authorized HTTP/API calls to separate private review only; not rendered browser or original Cloudflare verification','origin':origin,'checks':checks,'browser_tested':False}
try:
    raw,info=request('/api/stats');state=json.loads(raw)
    for step in range(150):
        if state.get('ready') and state.get('artwork_ready'):break
        raw,info=request('/api/initialize','POST');progress=json.loads(raw)
        if step%10==0:print(json.dumps({'import_step':step,'progress':progress.get('progress')}),flush=True)
        if progress.get('ready'):state=json.loads(request('/api/stats')[0])
    else:raise RuntimeError('Preview catalogue did not finish initialization within 150 steps')
    if state.get('works')!=20512:raise RuntimeError('Unexpected review catalogue count')
    for path in ['/','/technology/lenses','/technology/film/16-mm-film','/crew/camera','/discover','/world','/journal','/attributions','/api/films?q=moon&country=France&year=1902','/api/films/work-trip-to-the-moon','/api/programming?seed=private-review-check','/photos/prime-lens-640.webp','/photos/macro-lens-640.webp','/photos/16mm-movie-film-640.webp']:
        raw,info=request(path)
        if path.endswith('.webp'):
            local=Path('public'+path).read_bytes()
            if hashlib.sha256(raw).digest()!=hashlib.sha256(local).digest():raise RuntimeError('Deployed image hash mismatch: '+path)
        if path.startswith('/api/'):
            value=json.loads(raw)
            if '?q=moon' in path and value.get('total')!=1:raise RuntimeError('Multifilter mismatch')
    report.update(status='PASS_HTTP_API_ONLY',catalogue_stats=state)
except Exception as exc:
    report.update(status='BLOCKED_OR_FAILED',error_reason=type(exc).__name__+': '+str(exc))
finally:
    Path('release/evidence/PRIVATE_REVIEW_HTTP.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'status':report.get('status'),'checks':len(checks),'error_reason':report.get('error_reason')}),flush=True)
