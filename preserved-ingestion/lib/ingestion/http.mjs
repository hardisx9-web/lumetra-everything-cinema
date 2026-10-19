import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export class SourceAccessError extends Error {
  constructor(code, url, status, message) { super(message || code); Object.assign(this, { code, url, status }); }
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
export const clean = (value) => load(`<span>${value || ''}</span>`)('span').text().replace(/\s+/gu, ' ').trim();
export const absolute = (value, base) => { if (typeof value !== 'string' || !value.trim()) return null; try { const url = new URL(value, base); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
export const normalizeTitle = (value = '') => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const clipTitle = (title) => /\b(trailer|teaser|excerpt|extrait|bande.annonce|rushes|chutes|fragment|screen test)\b/iu.test(title || '');
export function parseJson(body) {
  try { return JSON.parse(body.trim()); } catch {
    // UNAM's public REST controller erroneously prepends rendered HTML. Only accept an actual REST array suffix.
    const start = body.indexOf('[{"id"');
    if (start >= 0) return JSON.parse(body.slice(start));
    const datos = body.indexOf('{"datos"');
    if (datos >= 0) return JSON.parse(body.slice(datos));
    throw new Error('SOURCE_RESPONSE_NOT_JSON');
  }
}
export function assignmentJson(body, variable) {
  const start = body.indexOf(variable);
  if (start < 0) return null;
  const objectStart = body.indexOf('{', start);
  let depth = 0, string = false, escaped = false;
  for (let i = objectStart; i < body.length; i += 1) {
    const c = body[i];
    if (string) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') string = false; }
    else if (c === '"') string = true;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(body.slice(objectStart, i + 1)); } catch { return null; } }
  }
  return null;
}
export function evidence(kind, url, value, method, checkedAt = new Date().toISOString()) {
  return { kind, url, value, method, checked_at: checkedAt };
}
export function safeMediaUrl(url) {
  // Never persist short-lived access signatures or cookies from provider players.
  const u = new URL(url); return `${u.origin}${u.pathname}`;
}

export class SourceHttp {
  constructor({ intervalMs = 250, timeoutMs = 20000 } = {}) {
    this.intervalMs = intervalMs; this.timeoutMs = timeoutMs; this.next = new Map(); this.blocked = new Map(); this.requests = [];
  }
  async request(url, options = {}) {
    const host = new URL(url).host;
    if (this.blocked.has(host)) throw this.blocked.get(host);
    const now = Date.now(); const due = Math.max(now, this.next.get(host) || 0);
    this.next.set(host, due + (options.intervalMs ?? (host.endsWith('loc.gov') ? 3200 : this.intervalMs)));
    await sleep(Math.max(0, due - now));
    // A concurrent worker may have received a denial while this request was queued.
    // Respect that denial before dispatch, not just before waiting for a rate slot.
    if (this.blocked.has(host)) throw this.blocked.get(host);
    let response;
    try {
      response = await fetch(url, { method: options.method || 'GET', body: options.body,
        headers: { 'user-agent': 'GlobalCinemaSourceRegistry/2.0 (official-catalogue-research)', accept: 'application/json,text/html,application/xml;q=0.9,*/*;q=0.5', ...(options.headers || {}) },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: options.redirect || 'follow' });
    } catch (error) {
      const failure = new SourceAccessError('SOURCE_UNAVAILABLE', safeMediaUrl(url), 0, error.cause?.code || error.message);
      this.requests.push({ url: safeMediaUrl(url), status: 0, error: failure.message, checked_at: new Date().toISOString() }); throw failure;
    }
    const maxBytes = options.maxBytes || 20000000;
    const chunks = []; let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > maxBytes) { await reader.cancel(); throw new SourceAccessError('SOURCE_RESPONSE_TOO_LARGE', safeMediaUrl(url), response.status); }
        chunks.push(part.value);
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const status = response.status;
    this.requests.push({ url: safeMediaUrl(url), status, checked_at: new Date().toISOString(), bytes, sha256: digest(body) });
    if ([401,403,429].includes(status) || /<title>\s*(Just a moment|Access Denied|Security Verification)/iu.test(body) || /challenges\.cloudflare\.com\/.*challenge/iu.test(body)) {
      const failure = new SourceAccessError('SOURCE_ACCESS_BLOCKED', safeMediaUrl(url), status, `Access denied/rate limited at ${safeMediaUrl(url)}; no protection bypass attempted.`);
      this.blocked.set(host, failure); throw failure;
    }
    if (!response.ok && !(options.redirect === 'manual' && status >= 300 && status < 400)) throw new SourceAccessError('SOURCE_UNAVAILABLE', safeMediaUrl(url), status, `HTTP ${status}`);
    return { body, url: response.url, status, headers: Object.fromEntries(response.headers), sha256: digest(body) };
  }
  async json(url, options = {}) { const doc = await this.request(url, options); return { ...doc, data: parseJson(doc.body) }; }
}

export async function checkHls(http, sourceUrl, expectedMinutes) {
  const first = await http.request(sourceUrl, { maxBytes: 2000000 });
  if (!first.body.startsWith('#EXTM3U')) return { verified: false, reason: 'SOURCE_NOT_HLS' };
  let playlist = first;
  if (first.body.includes('#EXT-X-STREAM-INF')) {
    const lines = first.body.split(/\r?\n/); const index = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
    const relative = lines.slice(index + 1).find((line) => line.trim() && !line.startsWith('#'));
    if (!relative) return { verified: false, reason: 'SOURCE_NO_MEDIA_PLAYLIST' };
    const child = new URL(relative.trim(), first.url);
    // HLS query tokens only propagate if the official player itself specifies them in child URLs.
    // No token rewriting or DRM/geo circumvention.
    playlist = await http.request(child.href, { maxBytes: 2000000 });
  }
  const seconds = [...playlist.body.matchAll(/#EXTINF:([0-9.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  const complete = playlist.body.includes('#EXT-X-ENDLIST') && seconds > 0;
  const durationMatches = Number(expectedMinutes) > 0 && Math.abs(seconds / 60 - expectedMinutes) <= Math.max(2, expectedMinutes * 0.12);
  const encrypted = /#EXT-X-KEY:.*METHOD=(?!NONE)/u.test(playlist.body);
  let mediaAccessible = false;
  if (complete && durationMatches && !encrypted) {
    const lines = playlist.body.split(/\r?\n/);
    const segment = lines.find((line) => line.trim() && !line.startsWith('#'));
    if (segment) {
      // Only a media-header probe, not a film download. Never fetch DRM keys or rewrite access tokens.
      const probe = await http.request(new URL(segment.trim(), playlist.url).href, { method: 'HEAD' });
      mediaAccessible = probe.status === 200 && Number(probe.headers['content-length']) > 0
        && /video|octet-stream|mp2t/iu.test(probe.headers['content-type'] || '');
    }
  }
  return { verified: complete && durationMatches && mediaAccessible && !encrypted, duration_minutes: seconds / 60,
    evidence: evidence('LIVE_SOURCE', safeMediaUrl(sourceUrl), { manifest_status: first.status, vod_endlist: complete, duration_minutes: seconds / 60, duration_matches: durationMatches, media_segment_accessible: mediaAccessible, encrypted, playlist_sha256: playlist.sha256 }, 'Official player HLS VOD duration/endlist and media segment HEAD checked; no film downloaded or rehosted.'),
    reason: !complete ? 'SOURCE_NOT_COMPLETE_VOD' : !durationMatches ? 'SOURCE_DURATION_CONFLICT' : encrypted ? 'SOURCE_ENCRYPTED_REQUIRES_PLAYER_REVIEW' : !mediaAccessible ? 'SOURCE_MEDIA_UNCONFIRMED' : null };
}
