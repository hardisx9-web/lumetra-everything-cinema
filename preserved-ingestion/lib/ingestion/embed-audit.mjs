import { load } from 'cheerio';
import { assignmentJson, digest, evidence, normalizeTitle, safeMediaUrl, sleep } from './http.mjs';

const providerHosts = new Set(['www.nfb.ca', 'www.onf.ca', 'help.nfb.ca', 'aide.onf.ca']);
export function officialNfbUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && providerHosts.has(u.hostname) && !u.username && !u.password; } catch { return false; }
}
const filmUrl = (value) => officialNfbUrl(value) && ['www.nfb.ca', 'www.onf.ca'].includes(new URL(value).hostname);
const framePolicies = (headers) => String(headers['content-security-policy'] || '').split(',').flatMap((policy) => policy.split(';').map((s) => s.trim()).filter((s) => /^frame-ancestors(?:\s|$)/iu.test(s)));
export function inspectFramePolicy(headers = {}) {
  const xfo = String(headers['x-frame-options'] || '').trim();
  const ancestors = framePolicies(headers);
  // Do not mistake frame-src (the player's children) for frame-ancestors (its parents).
  // Fail conservatively on conflicting XFO even where a modern browser might prefer CSP.
  if (/\b(?:DENY|SAMEORIGIN)\b/iu.test(xfo)) return { status: 'DISABLED', reason: 'PLAYER_X_FRAME_OPTIONS_RESTRICTS_THIRD_PARTY', x_frame_options: xfo, frame_ancestors: ancestors };
  if (ancestors.some((s) => /'none'/iu.test(s) || /^frame-ancestors\s+'self'\s*$/iu.test(s))) return { status: 'DISABLED', reason: 'PLAYER_CSP_RESTRICTS_THIRD_PARTY', x_frame_options: xfo || null, frame_ancestors: ancestors };
  if (xfo || ancestors.some((s) => s.trim() !== 'frame-ancestors *')) return { status: 'UNCONFIRMED', reason: 'PLAYER_ORIGIN_RESTRICTION_REQUIRES_REVIEW', x_frame_options: xfo || null, frame_ancestors: ancestors };
  return { status: 'NO_HEADER_RESTRICTION_OBSERVED', x_frame_options: null, frame_ancestors: ancestors };
}

// Text-only, HTTPS, normal unauthenticated requests. No referer/origin impersonation,
// cookies, media requests, JS execution, alternate access route, or disabled TLS checks.
export class EmbedHttp {
  constructor({ intervalMs = 250, timeoutMs = 20000, blockedHosts = {} } = {}) {
    this.intervalMs = intervalMs; this.timeoutMs = timeoutMs; this.next = new Map();
    this.blockedHosts = { ...blockedHosts }; this.requests = 0;
  }
  async request(target) {
    let url = target;
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!officialNfbUrl(url)) throw Object.assign(new Error('UNTRUSTED_PROVIDER_URL'), { code: 'UNTRUSTED_PROVIDER_URL' });
      const host = new URL(url).hostname;
      if (this.blockedHosts[host]) throw Object.assign(new Error('PROVIDER_ACCESS_BLOCKED_CHECKPOINT'), { ...this.blockedHosts[host], code: 'PROVIDER_ACCESS_BLOCKED_CHECKPOINT', url: safeMediaUrl(url) });
      const now = Date.now(), due = Math.max(now, this.next.get(host) || 0);
      this.next.set(host, due + this.intervalMs); await sleep(Math.max(0, due - now));
      // Another worker may have observed a denial while this one awaited its slot.
      if (this.blockedHosts[host]) throw Object.assign(new Error('PROVIDER_ACCESS_BLOCKED_CHECKPOINT'), { ...this.blockedHosts[host], code: 'PROVIDER_ACCESS_BLOCKED_CHECKPOINT', url: safeMediaUrl(url) });
      let response;
      try {
        this.requests++;
        response = await fetch(url, { headers: { 'user-agent': 'GlobalCinemaEmbedAudit/1.0 (provider-permission-research)', accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) { throw Object.assign(new Error(e.cause?.code || e.message), { code: 'EMBED_NETWORK_ERROR', url: safeMediaUrl(url), status: 0 }); }
      if ([401, 403, 429].includes(response.status)) {
        await response.body?.cancel();
        const denied = { code: 'PROVIDER_ACCESS_BLOCKED', status: response.status, url: safeMediaUrl(url), checked_at: new Date().toISOString(), retry_after: response.headers.get('retry-after') };
        this.blockedHosts[host] = denied; throw Object.assign(new Error(denied.code), denied);
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel(); const location = response.headers.get('location');
        if (!location) throw Object.assign(new Error('EMBED_REDIRECT_WITHOUT_LOCATION'), { code: 'EMBED_REDIRECT_WITHOUT_LOCATION', status: response.status, url: safeMediaUrl(url) });
        const next = new URL(location, url).href;
        if (!officialNfbUrl(next)) throw Object.assign(new Error('EMBED_REDIRECT_OUTSIDE_PROVIDER'), { code: 'EMBED_REDIRECT_OUTSIDE_PROVIDER', status: response.status, url: safeMediaUrl(url) });
        url = next; continue;
      }
      const status = response.status;
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`HTTP ${status}`), { code: 'EMBED_HTTP_ERROR', status, url: safeMediaUrl(url) }); }
      if (!/text\/html/iu.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); throw Object.assign(new Error('EMBED_NON_HTML_RESPONSE'), { code: 'EMBED_NON_HTML_RESPONSE', status, url: safeMediaUrl(url) }); }
      const chunks = []; let bytes = 0;
      try {
        const reader = response.body.getReader();
        while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 2000000) { await reader.cancel(); throw new Error('EMBED_RESPONSE_TOO_LARGE'); } chunks.push(part.value); }
      } catch (e) { throw Object.assign(new Error(e.message), { code: 'EMBED_RESPONSE_READ_ERROR', status, url: safeMediaUrl(url) }); }
      const body = Buffer.concat(chunks).toString('utf8');
      if (/<title>\s*(Just a moment|Access Denied|Security Verification)/iu.test(body) || /challenges\.cloudflare\.com\/.*challenge/iu.test(body)) {
        const denied = { code: 'PROVIDER_ACCESS_CHALLENGE', status, url: safeMediaUrl(url), checked_at: new Date().toISOString() };
        this.blockedHosts[host] = denied; throw Object.assign(new Error(denied.code), denied);
      }
      return { body, status, url, sha256: digest(body), bytes, headers: Object.fromEntries(response.headers) };
    }
    throw Object.assign(new Error('EMBED_TOO_MANY_REDIRECTS'), { code: 'EMBED_TOO_MANY_REDIRECTS', url: safeMediaUrl(target) });
  }
}

export async function auditNfbPolicy(http) {
  const url = 'https://help.nfb.ca/terms/';
  try {
    const doc = await http.request(url), $ = load(doc.body);
    $('script,style,nav,footer,header').remove();
    const text = $('body').text().replace(/\s+/gu, ' ').trim();
    const section = 'Sharing of NFB Content (embedding)';
    const start = text.toLowerCase().lastIndexOf(section.toLowerCase());
    const excerpt = start >= 0 ? text.slice(start, text.indexOf('Official languages notice', start) > start ? text.indexOf('Official languages notice', start) : start + 4000) : null;
    const notice = text.match(/Any use of this content for institutional.{0,500}?prior written authorization from the NFB\./iu)?.[0] || null;
    const writtenLicence = text.match(/To use the content of the NFB.{0,300}?first obtain a written licence\./iu)?.[0] || null;
    // An explicit conditional offer is not approval of Global Cinema's use.
    const conditional = /embed/iu.test(text) && /commercial/iu.test(text) && /link/iu.test(text);
    return { provider: 'nfb_canada', permission_status: conditional ? 'CONDITIONAL' : 'UNCERTAIN', checked_at: new Date().toISOString(),
      project_use_confirmed: false, conditions: ['PERSONAL_PRIVATE_NONCOMMERCIAL_USE_OR_APPLICABLE_WRITTEN_NFB_PERMISSION', 'INSTITUTIONAL_EDUCATIONAL_NONPRIVATE_USE_REQUIRES_WRITTEN_LICENCE', 'OFFICIAL_UNMODIFIED_PLAYER', 'PROVIDER_BRANDING_AND_REQUIRED_LINKBACK_ATTRIBUTION', 'TITLE_TERRITORY_AND_SITE_CONTENT_CONDITIONS', 'NO_RESTRICTION_BYPASS'],
      evidence: [evidence('EMBED_PROVIDER_TERMS', url, { status: doc.status, sha256: doc.sha256, excerpt, institutional_use_notice: notice, written_licence_requirement: writtenLicence, conditional_offer_observed: conditional, project_personal_private_noncommercial_use: 'NOT_CONFIRMED', written_nfb_permission: 'NOT_PROVIDED', permission_for_global_cinema: 'NOT_ESTABLISHED' }, 'Current official terms fetched; the personal/noncommercial embedding offer and written-licence requirements are reviewed together, not reduced to free access.')],
      reason_codes: [conditional ? 'PROJECT_PERSONAL_PRIVATE_NONCOMMERCIAL_USE_OR_NFB_LICENCE_UNCONFIRMED' : 'PROVIDER_TERMS_PERMISSION_UNCONFIRMED'] };
  } catch (error) {
    return { provider: 'nfb_canada', permission_status: 'UNCERTAIN', checked_at: new Date().toISOString(), project_use_confirmed: false,
      error_code: error.code || 'PROVIDER_TERMS_ERROR', reason_codes: ['PROVIDER_TERMS_UNAVAILABLE'],
      evidence: [evidence('EMBED_PROVIDER_TERMS_ERROR', url, { code: error.code || 'PROVIDER_TERMS_ERROR', status: error.status || null }, 'Terms access failed; permission is not inferred from an embed URL.')] };
  }
}

export async function auditEmbedSource(source, http, policy) {
  const result = { checked_at: new Date().toISOString(), outcome: 'MANUAL_REVIEW', permission_status: policy?.permission_status || 'UNCERTAIN', technical_status: 'UNCONFIRMED',
    reason_codes: [...(policy?.reason_codes || ['PROVIDER_PERMISSION_AUDIT_REQUIRED'])], error_code: policy?.error_code || null,
    embed_status: 'UNKNOWN', embed_working: false, embed_url_if_allowed: null, evidence: [...(policy?.evidence || [])] };
  const add = (kind, url, value, method) => result.evidence.push(evidence(kind, safeMediaUrl(url), value, method));
  const disabled = (reason) => { result.outcome = 'TECHNICALLY_DISABLED'; result.technical_status = 'DISABLED'; result.reason_codes.push(reason); };
  try {
    if (source.registry_source_id !== 'nfb_canada') { result.reason_codes.push('PROVIDER_EMBED_ADAPTER_UNAVAILABLE'); return result; }
    if (!filmUrl(source.canonical_source_url) || !/^\/film\/[^/]+\/$/u.test(new URL(source.canonical_source_url).pathname)) throw Object.assign(new Error('UNTRUSTED_CANONICAL_FILM_URL'), { code: 'UNTRUSTED_CANONICAL_FILM_URL' });
    const doc = await http.request(source.canonical_source_url);
    if (safeMediaUrl(doc.url) !== safeMediaUrl(source.canonical_source_url)) throw Object.assign(new Error('FILM_DETAIL_IDENTITY_REDIRECT'), { code: 'FILM_DETAIL_IDENTITY_REDIRECT' });
    const $ = load(doc.body), title = $('h1').first().text().replace(/\s+/gu, ' ').trim();
    const titles = [source.metadata?.title, source.metadata?.original_title, ...(source.metadata?.alternate_titles || [])].filter(Boolean);
    const titleMatches = !!title && titles.some((t) => normalizeTitle(t) === normalizeTitle(title));
    add('EMBED_FILM_DETAIL', doc.url, { status: doc.status, sha256: doc.sha256, title, title_matches: titleMatches }, 'Current existing canonical film page fetched; no catalogue enumeration or full-film sweep repeated.');
    if (!titleMatches) { result.reason_codes.push('FILM_DETAIL_TITLE_UNCONFIRMED'); return result; }
    const template = $('template[data-ui-el="embed-default-text"]').html();
    const offered = load(template || ''), offeredUrl = offered('iframe[src]').first().attr('src');
    if (!offeredUrl) { result.reason_codes.push('NO_THIRD_PARTY_EMBED_OFFER_OBSERVED'); return result; }
    if (!filmUrl(offeredUrl)) throw Object.assign(new Error('UNTRUSTED_OFFERED_PLAYER_URL'), { code: 'UNTRUSTED_OFFERED_PLAYER_URL' });
    const u = new URL(offeredUrl), canonical = new URL(source.canonical_source_url);
    if (u.origin !== canonical.origin || u.pathname !== `${canonical.pathname}embed/player/` || u.search || u.hash) throw Object.assign(new Error('OFFERED_PLAYER_IDENTITY_UNCONFIRMED'), { code: 'OFFERED_PLAYER_IDENTITY_UNCONFIRMED' });
    const attribution = offered('p').text().replace(/\s+/gu, ' ').trim();
    const links = offered('p a[href]').map((i, n) => ({ text: offered(n).text().trim(), url: offered(n).attr('href') })).get().filter((l) => officialNfbUrl(l.url)).map((l) => ({ ...l, url: safeMediaUrl(l.url) }));
    add('EMBED_PROVIDER_OFFER', doc.url, { observed_player_url: offeredUrl, origin: 'PROVIDER_SHARE_TEMPLATE', attribution, attribution_links: links }, 'Exact film-specific provider share-template iframe and attribution observed; no embed URL guessed or fabricated.');
    const player = await http.request(offeredUrl);
    if (safeMediaUrl(player.url) !== safeMediaUrl(offeredUrl)) throw Object.assign(new Error('PLAYER_IDENTITY_REDIRECT'), { code: 'PLAYER_IDENTITY_REDIRECT' });
    const frame = inspectFramePolicy(player.headers);
    add('EMBED_FRAME_POLICY', player.url, { status: player.status, sha256: player.sha256, ...frame }, 'Actual player response X-Frame-Options and enforced CSP frame-ancestors checked; restrictions respected, not bypassed.');
    if (frame.status === 'DISABLED') { disabled(frame.reason); return result; }
    const options = assignmentJson(player.body, 'window.IFRAME_OPTIONS');
    if (!options) { result.reason_codes.push('PLAYER_CONFIG_UNAVAILABLE'); return result; }
    const expectedId = source.metadata?.external_identifiers?.nfb_version || source.metadata?.version_id || source.metadata?.raw?.id;
    const identity = expectedId && String(options.gtm?.registryId) === String(expectedId) && titles.some((t) => normalizeTitle(t) === normalizeTitle(options.overlay?.title));
    const fullFilm = options.gtm?.versionType === 'film', embedMode = options.gtm?.embedMode === true;
    const hasSource = typeof options.source === 'string' && options.source.startsWith('https://');
    const branding = options.overlay?.showLogo === true && options.overlay?.showShare === true;
    const linkback = options.overlay?.url === source.canonical_source_url && links.some((l) => l.url === source.canonical_source_url) && links.some((l) => l.text.includes('National Film Board'));
    add('EMBED_PLAYER_CONFIG', player.url, { version_id: options.gtm?.registryId || null, expected_version_id: expectedId || null, identity_matches: Boolean(identity), full_film: fullFilm,
      embed_mode: embedMode, public_media_config_present: hasSource, provider_logo_and_share_enabled: branding, required_linkback_observed: linkback,
      browser_iframe_playback_verified: false, media_fetched: false, tokens_persisted: false }, 'Only safe config fields retained. HTTP/config availability is NOT a successful third-party browser playback check.');
    if (!identity || !fullFilm || !embedMode) { result.reason_codes.push('PLAYER_FILM_OR_EMBED_IDENTITY_UNCONFIRMED'); return result; }
    if (!hasSource) { result.reason_codes.push('PLAYER_PUBLIC_MEDIA_CONFIG_UNAVAILABLE'); return result; }
    if (frame.status === 'UNCONFIRMED') result.reason_codes.push(frame.reason);
    if (!branding || !linkback || !attribution) result.reason_codes.push('REQUIRED_BRANDING_OR_ATTRIBUTION_REVIEW');
    result.technical_status = 'AVAILABLE_NOT_BROWSER_VERIFIED';
    result.reason_codes.push('GLOBAL_CINEMA_ORIGIN_NOT_CONFIRMED', 'BROWSER_IFRAME_PLAYBACK_NOT_VERIFIED');
    // Intentionally no promotion based on HTTP 200, iframe offer, free playback, or
    // permissive frame headers. Project terms and real origin playback remain review gates.
    return result;
  } catch (error) {
    result.error_code = error.code || 'EMBED_CHECK_ERROR';
    result.reason_codes.push(result.error_code);
    const at = error.url || source.canonical_source_url;
    add('EMBED_CHECK_ERROR', at, { code: result.error_code, http_status: error.status || null }, 'Failed closed; no authentication, geo, DRM, provider-control or access-protection bypass attempted.');
    if ([404, 410].includes(error.status)) disabled('FILM_OR_OFFERED_PLAYER_REMOVED');
    return result;
  } finally { result.checked_at = new Date().toISOString(); result.reason_codes = [...new Set(result.reason_codes)]; }
}
