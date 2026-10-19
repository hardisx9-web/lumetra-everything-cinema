import { writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(2); }
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
if (output && !/\.(json|js|mjs)$/.test(output)) { console.error('--output must end in .json, .js or .mjs'); process.exit(2); }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-export' });
try {
  await client.connect();
  const rows = (await client.query(`SELECT p.*,w.canonical_title,w.original_title,w.year,w.director,w.countries,w.alternate_titles,w.verification_level,w.coverage_tier,
    (SELECT canonical_url FROM media_asset a WHERE a.work_id=w.work_id AND a.asset_type='POSTER' AND a.license_verified AND a.usage_basis <> 'UNKNOWN' ORDER BY created_at DESC LIMIT 1) AS licensed_poster
    FROM public_watchable_sources p JOIN work w ON w.work_id=p.work_id ORDER BY w.work_id,p.source_id`)).rows;
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.work_id)) grouped.set(row.work_id, []);
    grouped.get(row.work_id).push(row);
  }
  const ingestedFilms = [...grouped.values()].map((sources) => {
    const first = sources[0];
    const playback = sources.map((s) => ({
      id: s.source_id, source_id: s.source_id, registry_source_id: s.registry_source_id, provider: s.source_owner,
      adapter: s.watch_state === 'WATCH_HERE' ? 'official' : 'external',
      embedAllowed: s.watch_state === 'WATCH_HERE', embedUrl: s.watch_state === 'WATCH_HERE' ? s.embed_url_if_allowed : null,
      title: s.metadata?.title || first.canonical_title, url: s.external_watch_url || s.canonical_source_url,
      canonical_source_url: s.canonical_source_url, external_watch_url: s.external_watch_url,
      embed_url_if_allowed: s.watch_state === 'WATCH_HERE' ? s.embed_url_if_allowed : null,
      watch_state: s.watch_state, embed_status: s.embed_status, embed_working: s.embed_working,
      verifier: 'provider-health-check', last_checked_at: s.last_checked_at, verification_evidence: s.verification_evidence,
      availability_expiry_if_known: s.availability_expiry_if_known,
      full_film_verified: true,
      free_verified: true, official_or_rights_verified: true, live_check_status: 'PASS',
      sourceHealth: 'ACTIVE_VERIFIED', lastVerified: s.last_checked_at, territories: s.territories,
      runtime: s.runtime, audio_languages: s.audio_languages, subtitle_languages: s.subtitle_languages,
      version_or_restoration: s.version_or_restoration, rightsBasis: 'RIGHTS_HOLDER_OR_INSTITUTIONAL_SOURCE',
    }));
    const primary = sources.find((s) => s.watch_state === 'WATCH_HERE') || first;
    return {
      id: first.work_id, title: first.canonical_title, displayTitle: first.canonical_title,
      originalTitle: first.original_title || first.canonical_title, alternateTitles: first.alternate_titles,
      year: first.year, director: first.director, countries: first.countries, historicalCountries: [], regions: [first.source_owner],
      languages: primary.audio_languages || [], form: 'uncategorized', genre: [], movement: [], existenceStatus: 'EXTANT',
      color: 'Unknown', silent: null, aspect: null, palette: 'coal',
      programmeNote: 'Source-backed record; editorial programme notes have not yet been researched.',
      versionNote: primary.version_or_restoration || 'Version/restoration details not supplied by this source.',
      runtime: primary.runtime, runtimeLabel: primary.runtime ? `${primary.runtime} min · source record` : 'Runtime pending research',
      verification: first.verification_level, coverageTier: first.coverage_tier,
      significance: 'Source-backed catalogue record. Editorial context remains pending research.',
      synopsis: 'See the official source record.', poster: first.licensed_poster ? { url: first.licensed_poster, verified: true, usage: 'LICENSED' } : null,
      availability: { badge: primary.watch_state === 'WATCH_HERE' ? 'WATCH HERE' : 'WATCH FREE EXTERNALLY',
        mode: primary.watch_state === 'WATCH_HERE' ? 'STREAM_FREE_EMBED' : 'STREAM_FREE_EXTERNAL',
        sources: playback, lastVerified: primary.last_checked_at },
      sources: playback.map((s) => ({ tier: 'T1', label: `${s.provider} · official playback record`, url: s.url })),
    };
  });
  const ingestedCatalogueMeta = { generatedAt: new Date().toISOString(), source: 'postgresql:public_watchable_sources',
    counts: { publishedWorks: ingestedFilms.length, playbackSources: rows.length } };
  const text = output?.endsWith('.js') || output?.endsWith('.mjs')
    ? `// Derived PostgreSQL cache. Never edit; database is the source of truth.\nexport const ingestedFilms = ${JSON.stringify(ingestedFilms, null, 2)};\nexport const ingestedCatalogueMeta = ${JSON.stringify(ingestedCatalogueMeta, null, 2)};\n`
    : `${JSON.stringify({ ingestedFilms, ingestedCatalogueMeta }, null, 2)}\n`;
  if (output) { const destination = resolve(output); const temporary = `${destination}.${process.pid}.tmp`; await writeFile(temporary, text); await rename(temporary, destination); console.log(JSON.stringify({ output, ...ingestedCatalogueMeta.counts })); }
  else process.stdout.write(text);
} catch (error) { console.error(`PostgreSQL export failed: ${error.message}`); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
