export const WATCH_STATES = Object.freeze({
  WATCH_HERE: 'WATCH_HERE',
  WATCH_FREE_EXTERNALLY: 'WATCH_FREE_EXTERNALLY',
  NO_VERIFIED_FREE_STREAM: 'NO_VERIFIED_FREE_STREAM',
});

export const SOURCE_LIFECYCLE = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  STAGED: 'STAGED',
  REVIEW: 'REVIEW',
  VERIFIED: 'VERIFIED',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

export const EMBED_STATUSES = Object.freeze({
  PERMITTED: 'PERMITTED',
  PROHIBITED: 'PROHIBITED',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

export const LIVE_CHECK_STATUSES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  PENDING: 'PENDING',
});

export const REQUIRED_PLAYBACK_SOURCE_FIELDS = Object.freeze([
  'source_id',
  'source_owner',
  'canonical_source_url',
  'film_id',
  'full_film_verified',
  'free_verified',
  'official_or_rights_verified',
  'embed_status',
  'embed_url_if_allowed',
  'external_watch_url',
  'territories',
  'audio_languages',
  'subtitle_languages',
  'version_or_restoration',
  'runtime',
  'first_verified_at',
  'last_checked_at',
  'verification_evidence',
  'availability_expiry_if_known',
]);

const asList = (value) => Array.isArray(value) ? [...new Set(value.filter(Boolean).map(String))] : [];
const asNullableString = (value) => value === undefined || value === null || value === '' ? null : String(value);
const asBoolean = (value) => value === true;
const asDate = (value) => asNullableString(value);
const hasHttpsUrl = (value) => typeof value === 'string' && /^https:\/\//i.test(value);

export function deriveWatchState(source, now = Date.now()) {
  const checked = Date.parse(source.last_checked_at || source.lastVerified || '');
  const expiry = source.availability_expiry_if_known ? Date.parse(source.availability_expiry_if_known) : null;
  const hardGate = source.full_film_verified === true
    && source.free_verified === true
    && source.official_or_rights_verified === true
    && source.live_check_status === LIVE_CHECK_STATUSES.PASS
    && hasHttpsUrl(source.canonical_source_url)
    && Number.isFinite(checked) && checked <= now && checked > now - 7 * 24 * 60 * 60 * 1000
    && (expiry === null || (Number.isFinite(expiry) && expiry > now));

  if (!hardGate) return WATCH_STATES.NO_VERIFIED_FREE_STREAM;
  if (source.embed_status === EMBED_STATUSES.PERMITTED && source.embed_working === true && hasHttpsUrl(source.embed_url_if_allowed)) return WATCH_STATES.WATCH_HERE;
  return hasHttpsUrl(source.external_watch_url) ? WATCH_STATES.WATCH_FREE_EXTERNALLY : WATCH_STATES.NO_VERIFIED_FREE_STREAM;
}

export function normalizePlaybackSource(input = {}) {
  const source = {
    source_id: asNullableString(input.source_id ?? input.sourceId),
    source_owner: asNullableString(input.source_owner ?? input.sourceOwner ?? input.provider),
    canonical_source_url: asNullableString(input.canonical_source_url ?? input.canonicalSourceUrl ?? input.url),
    film_id: asNullableString(input.film_id ?? input.filmId),
    full_film_verified: asBoolean(input.full_film_verified ?? input.fullFilmVerified),
    free_verified: asBoolean(input.free_verified ?? input.freeVerified),
    official_or_rights_verified: asBoolean(input.official_or_rights_verified ?? input.officialOrRightsVerified),
    embed_status: input.embed_status ?? input.embedStatus ?? EMBED_STATUSES.UNKNOWN,
    embed_working: asBoolean(input.embed_working ?? input.embedWorking),
    verifier: asNullableString(input.verifier),
    embed_url_if_allowed: asNullableString(input.embed_url_if_allowed ?? input.embedUrlIfAllowed ?? input.embedUrl),
    external_watch_url: asNullableString(input.external_watch_url ?? input.externalWatchUrl ?? input.url),
    territories: asList(input.territories),
    audio_languages: asList(input.audio_languages ?? input.audioLanguages),
    subtitle_languages: asList(input.subtitle_languages ?? input.subtitleLanguages),
    version_or_restoration: asNullableString(input.version_or_restoration ?? input.versionOrRestoration),
    runtime: input.runtime === undefined || input.runtime === null || input.runtime === '' ? null : Number(input.runtime),
    first_verified_at: asDate(input.first_verified_at ?? input.firstVerifiedAt),
    last_checked_at: asDate(input.last_checked_at ?? input.lastCheckedAt),
    verification_evidence: Array.isArray(input.verification_evidence ?? input.verificationEvidence) ? [...(input.verification_evidence ?? input.verificationEvidence)] : [],
    availability_expiry_if_known: asDate(input.availability_expiry_if_known ?? input.availabilityExpiryIfKnown),
    live_check_status: input.live_check_status ?? input.liveCheckStatus ?? LIVE_CHECK_STATUSES.PENDING,
    lifecycle_status: input.lifecycle_status ?? input.lifecycleStatus ?? SOURCE_LIFECYCLE.STAGED,
    registry_source_id: asNullableString(input.registry_source_id ?? input.registrySourceId),
    adapter_id: asNullableString(input.adapter_id ?? input.adapterId),
    discovered_at: asDate(input.discovered_at ?? input.discoveredAt),
    rejection_reason: asNullableString(input.rejection_reason ?? input.rejectionReason),
    error_code: asNullableString(input.error_code),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { ...input.metadata } : {},
  };
  source.watch_state = deriveWatchState(source);
  return source;
}

export function validatePlaybackSource(input) {
  const source = normalizePlaybackSource(input);
  const errors = [];
  const gateFailures = [];

  const nullableFields = new Set(['embed_url_if_allowed', 'availability_expiry_if_known', 'runtime', 'version_or_restoration']);
  for (const field of REQUIRED_PLAYBACK_SOURCE_FIELDS) {
    if (!nullableFields.has(field) && (source[field] === null || source[field] === undefined || source[field] === '')) errors.push(`missing ${field}`);
  }
  if (source.source_id && !/^source_[a-z0-9][a-z0-9_-]*$/i.test(source.source_id)) errors.push('source_id must be a stable source_ identifier');
  if (source.canonical_source_url && !hasHttpsUrl(source.canonical_source_url)) errors.push('canonical_source_url must use HTTPS');
  if (source.external_watch_url && !hasHttpsUrl(source.external_watch_url)) errors.push('external_watch_url must use HTTPS');
  if (source.embed_status && !Object.values(EMBED_STATUSES).includes(source.embed_status)) errors.push(`unknown embed_status ${source.embed_status}`);
  if (!Object.values(LIVE_CHECK_STATUSES).includes(source.live_check_status)) errors.push(`unknown live_check_status ${source.live_check_status}`);
  if (!Object.values(SOURCE_LIFECYCLE).includes(source.lifecycle_status)) errors.push(`unknown lifecycle_status ${source.lifecycle_status}`);
  if (source.runtime !== null && (!Number.isFinite(source.runtime) || source.runtime <= 0)) errors.push('runtime must be a positive number or null');
  if (source.embed_status === EMBED_STATUSES.PERMITTED && !hasHttpsUrl(source.embed_url_if_allowed)) errors.push('permitted embed requires embed_url_if_allowed');

  if (source.full_film_verified !== true) gateFailures.push('full_film_verified');
  if (source.free_verified !== true) gateFailures.push('free_verified');
  if (source.official_or_rights_verified !== true) gateFailures.push('official_or_rights_verified');
  if (source.live_check_status !== LIVE_CHECK_STATUSES.PASS) gateFailures.push('live_check_status');
  if (!source.last_checked_at) gateFailures.push('last_checked_at');
  if (!source.verification_evidence.length) gateFailures.push('verification_evidence');

  return {
    source,
    valid: errors.length === 0,
    publishable: errors.length === 0 && gateFailures.length === 0 && deriveWatchState(source) !== WATCH_STATES.NO_VERIFIED_FREE_STREAM,
    errors,
    gate_failures: gateFailures,
    watch_state: deriveWatchState(source),
  };
}

export class PlaybackSource extends Object {
  constructor(input) {
    super();
    Object.assign(this, normalizePlaybackSource(input));
  }

  validate() {
    return validatePlaybackSource(this);
  }

  toJSON() {
    return { ...this };
  }
}

export class SourceRegistry {
  constructor(registry = {}) {
    this.version = registry.registry_meta?.version || null;
    this.generated_date = registry.registry_meta?.generated_date || null;
    this.purpose = registry.registry_meta?.purpose || null;
    this.watch_states = registry.registry_meta?.watch_states || {};
    this.sources = Array.isArray(registry.sources) ? registry.sources.map((source) => ({ ...source })) : [];
    this.rights_holder_channels = Array.isArray(registry.rights_holder_channels_to_enumerate) ? registry.rights_holder_channels_to_enumerate.map((source) => ({ ...source })) : [];
    this.metadata_sources = Array.isArray(registry.metadata_sources) ? registry.metadata_sources.map((source) => ({ ...source })) : [];
  }

  get(sourceId) {
    return this.sources.find((source) => source.id === sourceId) || this.rights_holder_channels.find((source) => source.id === sourceId) || null;
  }

  approved(priority = null) {
    return this.sources.filter((source) => {
      const approved = source.status === 'APPROVED' || source.status === 'APPROVED_CONDITIONAL' || source.status === 'APPROVED_EXTERNAL_ONLY';
      return approved && (!priority || source.priority === priority);
    });
  }

  p0() {
    return this.approved('P0');
  }

  allEnumerationTargets() {
    return [...this.sources, ...this.rights_holder_channels];
  }

  validate() {
    const errors = [];
    const ids = new Set();
    for (const source of this.allEnumerationTargets()) {
      if (!source.id) errors.push('registry source missing id');
      if (ids.has(source.id)) errors.push(`duplicate registry source ${source.id}`);
      ids.add(source.id);
      if (!source.name) errors.push(`registry source ${source.id || '(unknown)'} missing name`);
      if (!source.official_url) errors.push(`registry source ${source.id || '(unknown)'} missing official_url`);
    }
    return { valid: errors.length === 0, errors, source_count: this.sources.length, rights_holder_count: this.rights_holder_channels.length };
  }

  toJSON() {
    return {
      registry_meta: { version: this.version, generated_date: this.generated_date, purpose: this.purpose, watch_states: this.watch_states },
      sources: this.sources,
      rights_holder_channels_to_enumerate: this.rights_holder_channels,
      metadata_sources: this.metadata_sources,
    };
  }
}
