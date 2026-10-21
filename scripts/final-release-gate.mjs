import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const inventory=JSON.parse(readFileSync('release/INVENTORY_RECONCILIATION.json','utf8'));
const text=name=>existsSync('release/evidence/'+name)?readFileSync('release/evidence/'+name,'utf8'):'';
const gate=(id,status,evidence,reason,remaining=null)=>({id,status,evidence,reason,remaining});
const unresolved=inventory.subject_statuses.filter(r=>!r.status.startsWith('VERIFIED_')).reduce((n,r)=>n+r.total,0);
const dependency=text('dependency-audit-retry.json');let dependencyResult;try{dependencyResult=JSON.parse(dependency);}catch{}
const gates=[
 gate('source_recovery','PASS',['../RECOVERY_STATUS_2026-10-19.md','../release-audit/evidence/recovery-hashes.json'],'Prior checkpoint and commit history retained; changes are additive on a continuation branch.'),
 gate('production_build',text('build-revised.log').includes('Build complete.')?'PASS':'FAIL',['evidence/build-revised.log'],'Framework production build.'),
 gate('typecheck',existsSync('release/evidence/typecheck-final.log')&&!text('typecheck-final.log').trim()?'PASS':'BLOCKED',['evidence/typecheck-final.log'],'Full project typecheck; empty log plus recorded zero exit in execution.'),
 gate('lint',/0 errors/.test(text('lint-final.log'))?'PASS_WITH_WARNINGS':'BLOCKED',['evidence/lint-final.log'],'Generated catalogue literals excluded from lint AST and checked by data tests; source lint retains warnings.'),
 gate('catalogue_integrity','PASS',['evidence/DATABASE_INTEGRITY.json','evidence/full-tests.log'],'D1-compatible SQLite import, quick_check, foreign keys and orphan checks; no claim of live PostgreSQL server restore.'),
 gate('images_and_rights',unresolved?'FAIL':'PASS',['IMAGE_REGISTRY.json','IMAGE_REQUIREMENTS.csv','IMAGE_EXCEPTIONS.csv'],'Identity and rights are mandatory per subject; conditional placements remain in the denominator.',unresolved),
 gate('image_rendering','BLOCKED',['FUNCTIONAL_QA.md'],'Actual browser actions were not executed because automatic approval review repeatedly failed: Selected model is at capacity.',inventory.placement_requirements),
 gate('editorial_review','FAIL',['EDITORIAL_AUDIT.csv'],'Word/source audit is automated triage. No page was promoted to independently fact-checked prose by this audit.',inventory.editorial_pages),
 gate('viewing_source_refresh','FAIL',['VIEWING_AVAILABILITY_REPORT.csv'],'Zero sources currently pass the inherited expiry gate. No timestamps or viewing permissions were fabricated.',inventory.viewing_records),
 gate('api_security_checks',/fail 0/.test(text('security-tests.log'))?'PASS':'FAIL',['evidence/security-tests.log','evidence/acquisition-safety-tests.log'],'Origin/method/throttling/escaping and ingestion URL/approval safeguards tested.'),
 gate('secret_pattern_scan','PASS_WITH_LIMITS',['evidence/SECRET_PATTERN_SCAN.json'],'No configured secret patterns found in 1,088 scanned working-tree files; not a complete historical or semantic secret audit.'),
 gate('dependency_vulnerabilities',dependencyResult?.error?'BLOCKED':'BLOCKED',['evidence/dependency-audit-retry.json','evidence/dependency-audit-exit.txt'],'Advisory retrieval timed out. No clean-vulnerability claim is made.'),
 gate('mobile_desktop_accessibility_performance','BLOCKED',['SECURITY_ACCESSIBILITY_PERFORMANCE.md','evidence/API_PERFORMANCE.json'],'API timings and responsive source contracts do not replace browser/device measurements.'),
 gate('postgresql_server_restore','BLOCKED',['../release-audit/evidence/database-row-counts.json'],'Prior complete PostgreSQL 18.6 SQL extraction retained; running-server restore and relational validation remain unperformed.'),
 gate('github_cloudflare_production_access','BLOCKED',['DEPLOYMENT_RUNBOOK.md'],'Lumetra repository search returned no accessible result; production credentials and live D1 contents were not inspected or changed.'),
 gate('private_preview','PASS',['PREVIEW.json'],'Separate owner-private review deployment confirmed successful; original Cloudflare website untouched.'),
 gate('private_preview_http_verification','BLOCKED',['evidence/PRIVATE_REVIEW_HTTP.json'],'Authorized HTTP/API verification of the private preview timed out before receiving any response; deployment success is not a claim of application validation.'),
 gate('owner_production_approval','BLOCKED',[],'Explicit approval still required before deployment to the existing Cloudflare website.')
];
const report={timestamp:new Date().toISOString(),overall:'BLOCKED',production_deployment_performed:false,owner_approval_required:true,legacy_pending:inventory.legacy.pending,canonical_subjects:inventory.canonical_subjects,canonical_unresolved:unresolved,placement_requirements:inventory.placement_requirements,placement_browser_checks_completed:0,gates};
writeFileSync('release/RELEASE_GATE.json',JSON.stringify(report,null,2));console.log(JSON.stringify({overall:report.overall,canonical_unresolved:unresolved,mandatory_gates:gates.length}));
process.exitCode=1;
