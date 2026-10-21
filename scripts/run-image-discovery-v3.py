#!/usr/bin/env python3
"""Subject-safe, provider-independent candidate discovery for Lumetra.

This intentionally does NOT approve images or claim public reuse rights. It retains
all original review records and writes candidates using the existing schema.
Run with the existing recovered source and .sites-runtime/release-review.sqlite.
"""
import argparse
import email.utils
import urllib.error
import urllib.parse
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import time

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('lumetra_acq',HERE/'acquire-authentic-images.py')
acq=importlib.util.module_from_spec(spec)
spec.loader.exec_module(acq)

PROVIDERS=('commons','loc')
SCHEMA='''CREATE TABLE IF NOT EXISTS image_provider_progress(
 canonical_subject_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 outcome TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 candidates_added INTEGER NOT NULL DEFAULT 0,
 error_reason TEXT,
 retry_after TEXT,
 PRIMARY KEY(canonical_subject_id,provider)
)'''
PRIORITY="CASE s.subject_type WHEN 'technology' THEN 0 WHEN 'camera-milestone' THEN 1 WHEN 'crew-role' THEN 2 WHEN 'film' THEN 3 ELSE 4 END"

def utc(): return dt.datetime.now(dt.timezone.utc).isoformat()
def later(minutes): return (dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=minutes)).isoformat()

def init(db):
    db.execute(SCHEMA)
    db.execute('CREATE TABLE IF NOT EXISTS provider_checkpoint(provider TEXT PRIMARY KEY, not_before TEXT, reason TEXT)')
    db.execute('PRAGMA foreign_keys=ON')
    db.commit()

def choose(db, provider, limit):
    # Important: do NOT filter on acquisition_queue.status. The older runner
    # marked the shared queue REVIEW_REQUIRED after checking only one provider.
    hold=db.execute('SELECT not_before FROM provider_checkpoint WHERE provider=?',(provider,)).fetchone()
    if hold and hold[0]>utc():return []
    return db.execute(f'''SELECT q.canonical_subject_id,q.search_query,s.subject_type
       FROM acquisition_queue q JOIN image_subject s USING(canonical_subject_id)
       LEFT JOIN image_provider_progress p
         ON p.canonical_subject_id=q.canonical_subject_id AND p.provider=?
       LEFT JOIN image_registry ir ON ir.canonical_subject_id=q.canonical_subject_id
       WHERE (ir.status IS NULL OR ir.status NOT LIKE 'VERIFIED_%')
         AND (p.outcome IS NULL OR (p.outcome='TRANSIENT_FAILURE' AND p.retry_after<=?))
       ORDER BY {PRIORITY},q.canonical_subject_id LIMIT ?''',(provider,utc(),limit)).fetchall()

def normalize(response, provider):
    if not isinstance(response,dict) or response.get('error'):
        raise ValueError('PROVIDER_API_ERROR_OR_INVALID_RESPONSE')
    if provider=='commons' and 'query' not in response and not response.get('batchcomplete'):
        raise ValueError('COMMONS_RESPONSE_SCHEMA_UNRECOGNIZED')
    if provider=='loc' and not isinstance(response.get('results'),list):
        raise ValueError('LOC_RESPONSE_SCHEMA_UNRECOGNIZED')
    pages=response.get('query',{}).get('pages',[]) if provider=='commons' else response.get('results',[])
    for page in pages:
        if provider=='commons':
            i=(page.get('imageinfo') or [{}])[0];source=i.get('descriptionurl');url=i.get('url')
        else:
            image=page.get('image_url') or []
            if isinstance(image,str): image=[image]
            source=page.get('id');url=image[0] if image else None
        if not (isinstance(url,str) and url.startswith('https://') and isinstance(source,str) and source.startswith('https://')):
            continue
        yield page,url,source

def query_url(query,provider):
    if provider=='loc':
        return 'https://www.loc.gov/photos/?'+urllib.parse.urlencode({'fo':'json','c':'8','q':query})
    return acq.query_url(query,provider)

def discover_one(row,provider):
    subject,query,_type=row
    started=utc()
    try:
        envelope,evidence=acq.cached_json(query_url(query,provider))
        candidates=[]
        for page,url,source in normalize(envelope['response'],provider):
            cid=hashlib.sha256(json.dumps([subject,source,url],sort_keys=True).encode()).hexdigest()
            candidates.append((cid,subject,url,source,provider,'IDENTITY_AND_RIGHTS_REVIEW_REQUIRED',
                 json.dumps({'page':page,'metadata_evidence':evidence,'policy':acq.POLICY[provider],'response_check':envelope.get('check')},ensure_ascii=False)))
        return (subject,provider,started,'CANDIDATES_RECORDED' if candidates else 'NO_MATCH_FOUND',candidates,evidence,None)
    except urllib.error.HTTPError as e:
        seconds=3600
        value=e.headers.get('Retry-After') if e.headers else None
        if value:
            try:seconds=max(seconds,int(value))
            except ValueError:
                try:seconds=max(seconds,(email.utils.parsedate_to_datetime(value)-dt.datetime.now(dt.timezone.utc)).total_seconds())
                except (TypeError,ValueError):pass
        return (subject,provider,started,'TRANSIENT_FAILURE',[],None,{'reason':f'HTTP {e.code}', 'retry_seconds':seconds,'http_status':e.code})
    except Exception as e:
        return (subject,provider,started,'TRANSIENT_FAILURE',[],None,f'{type(e).__name__}: {e}')

def process(db,subject,provider,started,outcome,candidates,evidence,error):
    inserted=0
    if outcome=='TRANSIENT_FAILURE':
        # Failure remains isolated to this provider and subject; the other
        # provider can continue. Pause retries instead of hammering a broken API.
        retry=later(60)
        if isinstance(error,dict):
            retry=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=error['retry_seconds'])).isoformat()
            error=json.dumps(error,sort_keys=True)
        db.execute('INSERT OR REPLACE INTO provider_checkpoint VALUES(?,?,?)',(provider,retry,error))
        db.execute('''INSERT OR REPLACE INTO image_provider_progress VALUES(?,?,?,?,?,?,?)''',
                   (subject,provider,outcome,utc(),0,error,retry))
        db.execute('''INSERT INTO acquisition_attempt(canonical_subject_id,provider,attempted_at,outcome,error_reason)
                      VALUES(?,?,?,?,?)''',(subject,provider,started,'PROVIDER_FAILURE',error))
    else:
        before=db.total_changes
        db.executemany('INSERT OR IGNORE INTO image_candidate VALUES(?,?,?,?,?,?,?)',candidates)
        inserted=db.total_changes-before
        db.execute('''INSERT OR REPLACE INTO image_provider_progress VALUES(?,?,?,?,?,?,?)''',
                   (subject,provider,outcome,utc(),inserted,None,None))
        db.execute('''INSERT INTO acquisition_attempt(canonical_subject_id,provider,attempted_at,http_status,outcome,evidence_path)
                      VALUES(?,?,?,?,?,?)''',(subject,provider,started,200,outcome,evidence))
        # NEVER modify image_registry.status or mark an image as VERIFIED.
        # Source / rights / identity approvals are separate review gates.
    db.commit()
    return inserted

def run(db,providers,limit,delay):
    tasks={p:choose(db,p,limit) for p in providers}
    print(json.dumps({'phase':'START','selected':{p:len(v) for p,v in tasks.items()},
                      'note':'candidate discovery only; no image verification or approvals; stops provider after first network failure'}),flush=True)
    def worker(provider, rows):
        for row in rows:
            yield discover_one(row,provider)
            if delay: time.sleep(delay)
    # Distinct providers can be queried independently; never parallelize
    # requests to the same provider beyond the configured courteous cadence.
    import queue,threading
    results=queue.Queue()
    def work(p,rows):
        # Stop this provider after its FIRST transport/API failure. Retrying all
        # ~27k subjects against a down provider wastes hours and quota.
        for data in worker(p,rows):
            results.put(data)
            if data[3]=='TRANSIENT_FAILURE':
                break
        results.put((None,p,None,None,None,None,None))
    threads=[threading.Thread(target=work,args=(p,rows),daemon=True) for p,rows in tasks.items()]
    for t in threads:t.start()
    closed=0;success=0;fail=0;found=0
    while closed<len(threads):
        item=results.get()
        if item[0] is None:closed+=1;continue
        added=process(db,*item)
        if item[3]=='TRANSIENT_FAILURE':
            fail+=1
            print(json.dumps({'provider':item[1],'subject':item[0],'status':'PROVIDER_ERROR','reason':item[6]}),flush=True)
        else:
            success+=1;found+=added
            if success%25==0 or item[4]:
                print(json.dumps({'provider':item[1],'subject':item[0],'status':item[3],
                                  'candidates':len(item[4]),'searched':success}),flush=True)
    for t in threads:t.join()
    print(json.dumps({'phase':'DONE','searches_completed':success,'failures':fail,
                      'candidate_records_inserted':found,'images_approved':0}),flush=True)
    return 0 if not fail else 2

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--providers',default='commons,loc',help='comma-separated commons,loc')
    p.add_argument('--limit-per-provider',type=int,default=250)
    p.add_argument('--delay',type=float,default=6.5,help='seconds between requests PER provider (6.5 default for conservative Wikimedia unauthenticated API quota)')
    p.add_argument('--db',default=str(acq.STATE),help='existing release-review.sqlite path')
    args=p.parse_args(argv)
    providers=args.providers.split(',')
    if not providers or len(set(providers))!=len(providers) or any(x not in PROVIDERS for x in providers):p.error('providers must be unique values from commons,loc')
    if not 1<=args.limit_per_provider<=50000:p.error('limit-per-provider must be 1..50000')
    if args.delay<6.2:p.error('delay must be >= 6.2 seconds per provider to respect conservative unauthenticated limits')
    if not Path(args.db).exists():p.error('Review DB missing: '+args.db)
    db=sqlite3.connect(args.db);init(db)
    try:return run(db,providers,args.limit_per_provider,args.delay)
    finally:db.close()

if __name__=='__main__': raise SystemExit(main())
