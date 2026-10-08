import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEmbedSource, auditNfbPolicy, inspectFramePolicy, EmbedHttp } from './embed-audit.mjs';
import { verifiedPromotion } from '../../db/embed-audit-store.mjs';

const canonical = 'https://www.nfb.ca/film/fixture/';
const embed = `${canonical}embed/player/`;
const source = { registry_source_id: 'nfb_canada', canonical_source_url: canonical, metadata: { title: 'Fixture Film', version_id: 123 } };
const options = { overlay: { title: 'Fixture Film', url: canonical, showLogo: true, showShare: true }, gtm: { registryId: 123, versionType: 'film', embedMode: true }, source: 'https://cdn.example/film.m3u8?Signature=SECRET' };
const detail = `<h1>Fixture Film</h1><template data-ui-el="embed-default-text"><iframe src="${embed}"></iframe><p><a href="${canonical}">Fixture Film</a>, <a href="https://www.nfb.ca/">provided by the National Film Board of Canada</a></p></template>`;
const policy = { permission_status: 'CONDITIONAL', reason_codes: ['PROJECT_USAGE_UNCONFIRMED'], evidence: [] };
function fixture({ body = detail, config = options, headers = {}, error } = {}) {
  const calls = [];
  return { calls, async request(url) { calls.push(url); if (error) throw error; return { body: url === canonical ? body : `window.IFRAME_OPTIONS = ${JSON.stringify(config)};`, url, status: 200, sha256: 'fixture', headers }; } };
}
test('frame policy distinguishes parent restrictions from child frame-src', () => {
  assert.equal(inspectFramePolicy({ 'content-security-policy': "frame-src 'self'; frame-ancestors *" }).status, 'NO_HEADER_RESTRICTION_OBSERVED');
  assert.equal(inspectFramePolicy({ 'content-security-policy': "frame-ancestors 'none'" }).status, 'DISABLED');
  assert.equal(inspectFramePolicy({ 'content-security-policy': "frame-ancestors 'self'" }).status, 'DISABLED');
  assert.equal(inspectFramePolicy({ 'x-frame-options': 'SAMEORIGIN' }).status, 'DISABLED');
  assert.equal(inspectFramePolicy({ 'content-security-policy': 'frame-ancestors https://provider.example' }).status, 'UNCONFIRMED');
  assert.equal(inspectFramePolicy({ 'content-security-policy': "frame-ancestors *, frame-ancestors 'none'" }).status, 'DISABLED');
});
test('offered current player never becomes WATCH_HERE from free/config/header evidence', async () => {
  const http = fixture(), result = await auditEmbedSource(source, http, policy);
  assert.equal(result.outcome, 'MANUAL_REVIEW'); assert.equal(result.technical_status, 'AVAILABLE_NOT_BROWSER_VERIFIED');
  assert.equal(result.embed_working, false); assert.equal(result.embed_url_if_allowed, null);
  assert.deepEqual(http.calls, [canonical, embed]); assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(result.evidence.some((e) => e.kind === 'EMBED_PROVIDER_OFFER' && e.value.attribution_links.length === 2));
});
test('missing offered iframe is review, never a guessed URL or claimed legal prohibition', async () => {
  const http = fixture({ body: '<h1>Fixture Film</h1>' }), result = await auditEmbedSource(source, http, policy);
  assert.equal(result.outcome, 'MANUAL_REVIEW'); assert.equal(result.embed_url_if_allowed, null);
  assert.deepEqual(http.calls, [canonical]);
});
test('actual XFO restriction is technically disabled and respected', async () => {
  const result = await auditEmbedSource(source, fixture({ headers: { 'x-frame-options': 'DENY' } }), policy);
  assert.equal(result.outcome, 'TECHNICALLY_DISABLED'); assert.equal(result.embed_working, false);
  assert.ok(result.reason_codes.includes('PLAYER_X_FRAME_OPTIONS_RESTRICTS_THIRD_PARTY'));
});
test('mismatched or incomplete player identity is not verified', async () => {
  const result = await auditEmbedSource(source, fixture({ config: { ...options, gtm: { ...options.gtm, registryId: 999 } } }), policy);
  assert.equal(result.technical_status, 'UNCONFIRMED'); assert.equal(result.embed_url_if_allowed, null);
});
test('removed player is technical unavailability, not a new failed free-source verification', async () => {
  const result = await auditEmbedSource(source, fixture({ error: Object.assign(new Error('gone'), { status: 404, code: 'EMBED_HTTP_ERROR' }) }), policy);
  assert.equal(result.outcome, 'TECHNICALLY_DISABLED'); assert.equal(result.error_code, 'EMBED_HTTP_ERROR');
  assert.equal(result.live_check_status, undefined); assert.equal(result.free_verified, undefined);
});
test('conditional terms include private use and written licence conflict without approving use', async () => {
  const text = `<body>Any use of this content for institutional, educational and non-commercial purposes is prohibited without prior written authorization from the NFB. <h2>Sharing of NFB Content (embedding)</h2>The Embeddable Content is for your personal use only and cannot be used in any commercial way. You must create a link back. <h2>Official languages notice</h2>To use the content of the NFB’s digital platforms for educational, institutional or non-commercial purposes, it is necessary to first obtain a written licence.</body>`;
  const result = await auditNfbPolicy({ async request(url) { return { body: text, status: 200, sha256: 'fixture', url }; } });
  assert.equal(result.permission_status, 'CONDITIONAL'); assert.equal(result.project_use_confirmed, false);
  assert.ok(result.evidence[0].value.institutional_use_notice); assert.ok(result.evidence[0].value.written_licence_requirement);
});
test('promotion requires permission and third-party browser proof, never a boolean alone', () => {
  const now = Date.now(), current = { ...source, work_id: 'work', external_watch_url: canonical, full_film_verified: true, free_verified: true, official_or_rights_verified: true, live_check_status: 'PASS', lifecycle_status: 'VERIFIED', last_checked_at: new Date(now - 1000).toISOString() };
  const result = { outcome: 'WATCH_HERE', permission_status: 'VERIFIED', technical_status: 'VERIFIED', embed_status: 'PERMITTED', embed_working: true, embed_url_if_allowed: embed, checked_at: new Date(now - 1).toISOString(), evidence: [] };
  assert.equal(verifiedPromotion(current, result, now), false);
  result.evidence = [{ kind: 'EMBED_PROJECT_PERMISSION', value: { permitted: true, usage_reviewed: true, attribution_verified: true, origin: 'https://global-cinema.example' } }, { kind: 'EMBED_BROWSER_PLAYBACK', url: embed, value: { played: true, third_party_iframe: true, provider_controls_preserved: true, restrictions_bypassed: false, origin: 'https://global-cinema.example' } }, { kind: 'EMBED_PROVIDER_OFFER', url: canonical, value: { observed_player_url: embed, origin: 'PROVIDER_SHARE_TEMPLATE' } }, { kind: 'EMBED_PLAYER_CONFIG', url: embed, value: { identity_matches: true, full_film: true, embed_mode: true, provider_logo_and_share_enabled: true, required_linkback_observed: true } }];
  assert.equal(verifiedPromotion(current, result, now), true);
  assert.equal(verifiedPromotion({ ...current, free_verified: false }, result, now), false);
  assert.equal(verifiedPromotion({ ...current, last_checked_at: new Date(now - 8 * 86400000).toISOString() }, result, now), false);
  assert.equal(verifiedPromotion({ ...current, availability_expiry_if_known: 'invalid' }, result, now), false);
  assert.equal(verifiedPromotion(current, { ...result, embed_url_if_allowed: 'https://unoffered.example/embed' }, now), false);
  result.evidence[1].value.restrictions_bypassed = true; assert.equal(verifiedPromotion(current, result, now), false);
});
test('blocked-host checkpoints prevent another request, including after resume', async () => {
  const http = new EmbedHttp({ blockedHosts: { 'www.nfb.ca': { status: 403, checked_at: new Date().toISOString() } } });
  const result = await auditEmbedSource(source, http, policy);
  assert.equal(result.error_code, 'PROVIDER_ACCESS_BLOCKED_CHECKPOINT'); assert.equal(http.requests, 0);
});
test('transport refuses untrusted URLs before making a request', async () => {
  const http = new EmbedHttp();
  await assert.rejects(http.request('http://www.nfb.ca/film/fixture/'), /UNTRUSTED_PROVIDER_URL/);
  await assert.rejects(http.request('https://not-nfb.example/'), /UNTRUSTED_PROVIDER_URL/);
  assert.equal(http.requests, 0);
});
