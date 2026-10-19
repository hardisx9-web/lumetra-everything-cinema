import { createHash } from 'node:crypto';

export const normalize = (value = '') => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const snapshotHash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const text = (value) => typeof value === 'string' ? value.trim() : '';
const names = (m) => [...new Set([m.title, m.original_title, m.display_title, ...(Array.isArray(m.alternate_titles) ? m.alternate_titles : [])].map(text).filter(Boolean))];
const countriesOf = (m) => [...new Set((Array.isArray(m.countries) ? m.countries : m.countries ? [m.countries] : m.country ? [m.country] : []).map(text).filter(Boolean))];

// Sparse creation is an explicit provider contract, not a caller-supplied "scope"
// or trust flag. URLs, unknown schemes and shared IDs never qualify.
const nativeSchemes = new Map([['bfi_player_free', new Map([['bfi_nid', /^[1-9]\d*$/]])]]);
function identifiersOf(m, sourceId) {
  const identifiers = [];
  const add = (scheme, value) => {
    scheme = String(scheme || '').trim().toLowerCase();
    if (!scheme || value == null || !['string', 'number'].includes(typeof value)) return;
    let id = String(value).trim();
    if (!id) return;
    // Do not treat unknown schemes, URLs, version IDs or arbitrary "scope" claims as globally shared identities.
    let shared = false;
    if (scheme === 'imdb' && /^tt\d+$/i.test(id)) { id = id.toLowerCase(); shared = true; }
    if (scheme === 'wikidata' && /^q\d+$/i.test(id)) { id = id.toUpperCase(); shared = true; }
    if (['tmdb', 'tmdb_movie'].includes(scheme) && /^\d+$/.test(id)) { scheme = 'tmdb_movie'; shared = true; }
    if (scheme === 'isan' && /^[\da-f-]{16,}$/i.test(id)) { id = id.toUpperCase(); shared = true; }
    const native = !shared && Boolean(nativeSchemes.get(sourceId)?.get(scheme)?.test(id));
    identifiers.push({ namespace: shared ? `shared:${scheme}` : `registry:${sourceId}:${scheme}`, id, scheme, shared, native });
  };
  const external = m.external_identifiers;
  if (Array.isArray(external)) for (const item of external) {
    if (item && typeof item === 'object') add(item.namespace || item.scheme || item.type, item.id ?? item.value);
  } else if (external && typeof external === 'object') for (const [scheme, values] of Object.entries(external)) {
    for (const value of Array.isArray(values) ? values : [values]) add(scheme, value && typeof value === 'object' ? value.id ?? value.value : value);
  }
  return [...new Map(identifiers.map((id) => [`${id.namespace}\0${id.id}`, id])).values()];
}

// Call inside a transaction for atomic identity/alias/evidence writes (the ingestion store does this).
// All reuse requires independent identity clues; title-only joins are deliberately forbidden.
export async function resolveWork(client, record) {
  const m = record.metadata || record;
  const sourceId = record.registry_source_id;
  const sourceUrl = record.canonical_source_url || record.source_url || m.source_url || null;
  const titles = names(m);
  const titleKeys = [...new Set(titles.map(normalize).filter(Boolean))];
  const hasYear = m.year != null && m.year !== '';
  const year = hasYear ? Number(m.year) : null;
  const director = normalize(text(m.director_credit));
  const countries = countriesOf(m);
  const countryKeys = countries.map(normalize);
  const runtime = Number(record.runtime ?? m.runtime) > 0 ? Number(record.runtime ?? m.runtime) : null;
  const external = m.external_id == null ? null : String(m.external_id).trim() || null;
  const identifiers = identifiersOf(m, sourceId);
  const nativeIds = identifiers.filter((id) => id.native);
  const completeMetadata = hasYear && Boolean(director);
  const clues = { titles, normalized_titles: titleKeys, year: Number.isFinite(year) ? year : null, director: m.director_credit || null, countries, runtime, external_id: external, external_identifiers: identifiers };
  const outcome = async (workId, review, method, decision, extra = {}) => {
    const evidence = { ...clues, ...extra, stage: record.resolution_stage || 'resolve' };
    const eventKey = snapshotHash({ run: record.ingest_run_id || null, candidate: record.candidate_id || null, sourceId, sourceUrl, decision, method, evidence });
    await client.query(`INSERT INTO work_resolution_event (event_key,work_id,ingest_run_id,candidate_id,registry_source_id,source_url,decision,match_method,confidence,evidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT DO NOTHING`,
    [eventKey, workId, record.ingest_run_id || null, record.candidate_id || null, sourceId || null, sourceUrl, decision, method, review ? 0 : method === 'metadata-alias' ? 0.95 : 1, JSON.stringify({ ...evidence, review })]);
    return { workId, review, evidence: { ...evidence, method, decision, review } };
  };
  const review = (reason, extra = {}) => outcome(null, reason, 'manual-review', 'REVIEW', extra);
  if (!titles.length || (!completeMetadata && !nativeIds.length)) return review('missing title/year/director');
  if (hasYear && (!Number.isInteger(year) || year < 1880 || year > 2200)) return review('invalid year');
  if (!titleKeys.length || (!director && !nativeIds.length)) return review('missing normalized title/director');
  if (!sourceId) return review('missing registry source namespace');
  for (const id of nativeIds) {
    if (identifiers.some((other) => other.namespace === id.namespace && other.id !== id.id)) return review('multiple conflicting identifiers in one provider-native namespace');
  }
  for (const id of identifiers.filter((item) => item.shared)) {
    if (identifiers.some((other) => other.namespace === id.namespace && other.id !== id.id)) return review('multiple conflicting identifiers in one shared namespace');
  }

  // Shared with other transactional resolver callers, including historical import.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['global-cinema-entity-resolution']);
  const compatible = (row, partial = false) => {
    // A provider-native identity may lack metadata, but known conflicting clues
    // still fail closed. Metadata/cross-source matching retains strict equality.
    if (partial) {
      if (hasYear && row.year != null && Number(row.year) !== year) return false;
      if (director && normalize(row.director || '') && normalize(row.director) !== director) return false;
    } else if (Number(row.year) !== year || normalize(row.director || '') !== director) return false;
    const priorCountries = (Array.isArray(row.countries) ? row.countries : []).map(normalize);
    if (countryKeys.length && priorCountries.length && !countryKeys.some((c) => priorCountries.includes(c))) return false;
    if (runtime && row.runtime && Math.abs(Number(row.runtime) - runtime) > Math.max(3, Math.min(runtime, Number(row.runtime)) * 0.1)) return false;
    return true;
  };
  const corroborated = (row) => (countryKeys.length && Array.isArray(row.countries) && row.countries.some((c) => countryKeys.includes(normalize(c)))) || (runtime && Number(row.runtime) > 0);
  const titleOverlap = async (row) => {
    if (names({ title: row.canonical_title, original_title: row.original_title, alternate_titles: row.alternate_titles }).some((title) => titleKeys.includes(normalize(title)))) return true;
    return (await client.query('SELECT 1 FROM work_title WHERE work_id=$1 AND normalized_title=ANY($2::text[]) LIMIT 1', [row.work_id, titleKeys])).rowCount > 0;
  };
  const idMatches = new Map();
  const localMatches = new Set();
  const nativeMatches = new Set();
  if (external) {
    const found = await client.query(`SELECT w.* FROM work_external_id e JOIN work w ON w.work_id=e.work_id WHERE e.registry_source_id=$1 AND e.external_id=$2`, [sourceId, external]);
    for (const row of found.rows) { idMatches.set(row.work_id, row); localMatches.add(row.work_id); }
  }
  if (identifiers.length) {
    const found = await client.query(`SELECT w.*,x.shared AS matched_shared,x.native AS matched_native FROM work_identifier i JOIN work w ON w.work_id=i.work_id
      JOIN jsonb_to_recordset($1::jsonb) AS x(namespace TEXT,id TEXT,shared BOOLEAN,native BOOLEAN) ON x.namespace=i.namespace AND x.id=i.external_id`, [JSON.stringify(identifiers)]);
    for (const row of found.rows) {
      idMatches.set(row.work_id, row);
      if (!row.matched_shared) localMatches.add(row.work_id);
      if (row.matched_native) nativeMatches.add(row.work_id);
    }
  }
  if (idMatches.size > 1) return review('external identifiers point to different works', { matched_work_ids: [...idMatches.keys()] });
  let match = [...idMatches.values()][0];
  let method = match && nativeMatches.has(match.work_id) ? 'provider-native-id' : identifiers.some((id) => id.shared) && match ? 'shared-external-id' : match ? 'namespaced-external-id' : null;
  if (match && !completeMetadata && !localMatches.has(match.work_id)) return review('insufficient metadata for shared external identifier reuse');
  if (match && !compatible(match, nativeIds.length > 0 && localMatches.has(match.work_id))) return review('namespaced/shared external id conflicts with work metadata', { matched_work_ids: [match.work_id] });

  if (sourceUrl) {
    const prior = await client.query(`SELECT DISTINCT w.* FROM work w WHERE w.work_id IN (
      SELECT work_id FROM playback_source WHERE registry_source_id=$1 AND canonical_source_url=$2 AND work_id IS NOT NULL
      UNION SELECT work_id FROM ingest_candidate WHERE registry_source_id=$1 AND source_url=$2 AND work_id IS NOT NULL
    )`, [sourceId, sourceUrl]);
    if (prior.rowCount > 1) return review('source URL is associated with multiple works', { matched_work_ids: prior.rows.map((row) => row.work_id) });
    const row = prior.rows[0];
    if (row) {
      if (!compatible(row, nativeIds.length > 0) || (match && match.work_id !== row.work_id) || (!match && !await titleOverlap(row)))
        return review('source URL identity conflicts with candidate metadata', { matched_work_ids: [row.work_id] });
      match = row; method ||= 'source-url-and-metadata';
    }
  }
  // Never look for title/year matches when taking the sparse native-ID path.
  if (!match && completeMetadata) {
    const found = await client.query(`SELECT DISTINCT w.* FROM work_title t JOIN work w ON w.work_id=t.work_id
      WHERE t.normalized_title=ANY($1::text[]) AND w.year=$2`, [titleKeys, year]);
    const compatibleMatches = found.rows.filter((row) => compatible(row));
    if (compatibleMatches.length > 1) return review('ambiguous title/year/director match', { matched_work_ids: compatibleMatches.map((row) => row.work_id) });
    if (compatibleMatches.length && !corroborated(compatibleMatches[0])) return review('insufficient country/runtime corroboration for metadata reuse', { matched_work_ids: [compatibleMatches[0].work_id] });
    match = compatibleMatches[0];
    if (match) method = 'metadata-alias';
  }
  if (match && !completeMetadata && !nativeMatches.has(match.work_id)) {
    const conflicts = await client.query(`SELECT i.namespace,i.external_id FROM work_identifier i
      JOIN jsonb_to_recordset($2::jsonb) AS x(namespace TEXT,id TEXT,native BOOLEAN) ON x.native AND x.namespace=i.namespace
      WHERE i.work_id=$1 AND i.external_id<>x.id`, [match.work_id, JSON.stringify(identifiers)]);
    if (conflicts.rowCount) return review('provider-native identifier conflicts with existing work identifier', { conflicting_identifiers: conflicts.rows });
  }
  if (match && identifiers.some((id) => id.shared)) {
    const conflicts = await client.query(`SELECT i.namespace,i.external_id FROM work_identifier i
      JOIN jsonb_to_recordset($2::jsonb) AS x(namespace TEXT,id TEXT,shared BOOLEAN) ON x.shared AND x.namespace=i.namespace
      WHERE i.work_id=$1 AND i.external_id<>x.id`, [match.work_id, JSON.stringify(identifiers)]);
    if (conflicts.rowCount) return review('shared external identifier conflicts with existing work identifier', { conflicting_identifiers: conflicts.rows });
  }
  const stableKey = nativeIds.length ? `identifier:${nativeIds[0].namespace}:${nativeIds[0].id}` : external ? `external:${sourceId}:${external}` : identifiers.length ? `identifier:${identifiers[0].namespace}:${identifiers[0].id}` : `title:${titleKeys[0]}|${year}|${director}|${[...countryKeys].sort().join(',')}|${runtime || ''}`;
  let workId = match?.work_id;
  let decision = 'REUSED';
  if (!workId) {
    workId = `work_ingested_${createHash('sha256').update(stableKey).digest('hex').slice(0, 24)}`;
    const inserted = await client.query(`INSERT INTO work (work_id,stable_key,canonical_title,original_title,year,director,countries,alternate_titles,runtime,metadata,verification_level,coverage_tier)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,'PROVISIONAL',1) ON CONFLICT DO NOTHING RETURNING work_id`,
    [workId, stableKey, text(m.display_title) || text(m.title) || titles[0], text(m.original_title) || text(m.title) || titles[0], year, text(m.director_credit) || null, JSON.stringify(countries), JSON.stringify(titles.slice(1)), runtime, JSON.stringify(m)]);
    if (!inserted.rowCount) {
      const prior = (await client.query('SELECT * FROM work WHERE stable_key=$1 OR work_id=$2', [stableKey, workId])).rows;
      if (prior.length !== 1 || !compatible(prior[0], nativeIds.length > 0)) return review('stable identity key collision');
      workId = prior[0].work_id;
      method = 'stable-key-and-metadata';
    } else { decision = 'CREATED'; method = !completeMetadata ? 'provider-native-provisional' : 'provisional-identity'; }
  }
  for (const [index, title] of titles.entries()) await client.query(`INSERT INTO work_title (work_id,title,normalized_title,title_type,source_id)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [workId, title, normalize(title), index ? 'ALTERNATE' : 'ORIGINAL', sourceId]);
  if (external) await client.query(`INSERT INTO work_external_id (registry_source_id,external_id,work_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [sourceId, external, workId]);
  for (const id of identifiers) await client.query(`INSERT INTO work_identifier (namespace,external_id,work_id,registry_source_id,identifier_scheme,evidence)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`, [id.namespace, id.id, workId, id.shared ? null : sourceId, id.scheme, JSON.stringify({ registry_source_id: sourceId, source_url: sourceUrl, year, director: m.director_credit })]);
  return outcome(workId, null, method, decision, { matched_work_ids: [workId] });
}
