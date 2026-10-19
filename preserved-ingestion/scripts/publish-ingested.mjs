// Never promote a historical JSON report into public availability.
// Publication is a derived cache of the PostgreSQL eligibility view only.
if (!process.argv.some((arg) => arg.startsWith('--output='))) process.argv.push('--output=src/data/ingested-catalogue.js');
await import('./db-export-public.mjs');
