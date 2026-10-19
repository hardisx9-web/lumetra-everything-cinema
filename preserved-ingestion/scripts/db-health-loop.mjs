// Run under a process supervisor (or prefer a daily scheduler invoking db-health-check.mjs).
// This loop does not install a system service; the operator must start/restart it.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const hours = Number(process.argv.find((arg) => arg.startsWith('--interval-hours='))?.slice(17) || 24);
if (!process.env.DATABASE_URL || !Number.isFinite(hours) || hours < 1 || hours > 168) {
  console.error('DATABASE_URL and --interval-hours=1..168 are required.');
  process.exit(2);
}
let running = true;
process.once('SIGTERM', () => { running = false; });
process.once('SIGINT', () => { running = false; });
while (running) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'db-health-check.mjs')], { stdio: 'inherit', env: process.env });
  if (result.error) console.error(`health loop spawn error: ${result.error.message}`);
  if (result.status !== 0) console.error(`health check exited with status ${result.status}; retrying next interval`);
  else {
    // Regenerate only the derived cache so downgraded sources disappear from the public catalogue too.
    const publication = spawnSync(process.execPath, [resolve(import.meta.dirname, 'db-export-public.mjs'), `--output=${resolve(import.meta.dirname, '../src/data/ingested-catalogue.js')}`], { stdio: 'inherit', env: process.env });
    if (publication.error || publication.status !== 0) console.error('Health evidence saved, but derived catalogue refresh failed.');
  }
  if (!running) break;
  await new Promise((done) => {
    const stop = () => { clearTimeout(timeout); finish(); };
    const finish = () => { process.off('SIGTERM', stop); process.off('SIGINT', stop); done(); };
    const timeout = setTimeout(finish, hours * 3600000);
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
}
