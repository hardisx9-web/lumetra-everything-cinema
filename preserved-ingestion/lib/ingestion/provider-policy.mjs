import { SourceHttp, SourceAccessError, evidence, safeMediaUrl } from './http.mjs';

export const NEW_PROVIDER_IDS = new Set(['bfi_player_free', 'eye_film_player', 'cinemateket_play_sweden', 'nfaj_japanese_animation_classics', 'nz_on_screen', 'angel_digital', 'shemaroo']);

// RFC 9309-style longest match, specific-agent groups before wildcard groups.
// Empty disallow is not a denial. Allow wins an equal-length tie.
export function robotsPolicy(body, target, agent = 'GlobalCinemaSourceRegistry') {
  const groups = []; let group = null, hasRules = false;
  for (const line of String(body).split(/\r?\n/)) {
    const match = line.replace(/#.*$/, '').trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [], delay: 0 }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow', 'crawl-delay'].includes(key)) {
      hasRules = true;
      if (key === 'crawl-delay') group.delay = Math.max(group.delay, Number(value) * 1000 || 0);
      else if (value) group.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && agent.toLowerCase().includes(a)));
  const selected = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const url = new URL(target), path = url.pathname + url.search;
  const rules = selected.flatMap(g => g.rules).filter(rule => {
    const anchored = rule.path.endsWith('$');
    const pattern = (anchored ? rule.path.slice(0, -1) : rule.path).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
  }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return { allowed: !rules.length || rules[0].allow, matched_rule: rules[0]?.path || null, intervalMs: Math.max(0, ...selected.map(g => g.delay)) };
}

export class ProviderHttp extends SourceHttp {
  constructor(options = {}) { super({ intervalMs: 500, ...options }); this.robots = new Map(); this.policyEvidence = []; }
  async policy(url) {
    const origin = new URL(url).origin;
    if (!this.robots.has(origin)) this.robots.set(origin, (async () => {
      const robotsUrl = `${origin}/robots.txt`;
      try {
        // Do not follow a robots redirect to an unrelated origin without checking it.
        const doc = await super.request(robotsUrl, { redirect: 'manual', maxBytes: 1000000 });
        if (doc.status >= 300) throw new SourceAccessError('SOURCE_ROBOTS_UNCONFIRMED', robotsUrl, doc.status, 'Redirected robots policy needs provider review.');
        this.policyEvidence.push(evidence('ROBOTS', robotsUrl, { status: doc.status, sha256: doc.sha256 }, 'Provider robots policy checked before automated catalogue/detail requests.'));
        return doc.body;
      } catch (error) {
        if (error.status === 404 || error.status === 410) {
          this.policyEvidence.push(evidence('ROBOTS', robotsUrl, { status: error.status, policy: 'NOT_PUBLISHED' }, 'No robots file published; access controls and rate limits still apply.'));
          return '';
        }
        throw error;
      }
    })());
    return robotsPolicy(await this.robots.get(origin), url);
  }
  async request(url, options = {}) {
    let current = url;
    for (let redirects = 0; redirects <= 10; redirects++) {
      const policy = await this.policy(current);
      if (!policy.allowed) throw new SourceAccessError('SOURCE_ROBOTS_DISALLOWED', safeMediaUrl(current), 0, `robots.txt disallows ${policy.matched_rule}; no alternate route used to evade it.`);
      const doc = await super.request(current, { ...options, intervalMs: Math.max(options.intervalMs || this.intervalMs, policy.intervalMs), redirect: 'manual' });
      if (doc.status < 300 || doc.status >= 400) return doc;
      if (!doc.headers.location) throw new SourceAccessError('SOURCE_REDIRECT_INVALID', safeMediaUrl(current), doc.status);
      current = new URL(doc.headers.location, current).href;
      if (!current.startsWith('https://')) throw new SourceAccessError('SOURCE_INSECURE_REDIRECT', safeMediaUrl(current), doc.status);
      // Never replay POST bodies across redirects or persist/reuse anonymous session tokens.
      if (options.method && !['GET', 'HEAD'].includes(options.method)) throw new SourceAccessError('SOURCE_API_REDIRECT_REVIEW_REQUIRED', safeMediaUrl(current), doc.status);
    }
    throw new SourceAccessError('SOURCE_REDIRECT_LOOP', safeMediaUrl(current), 0);
  }
}

export const httpForSource = (source) => NEW_PROVIDER_IDS.has(source.id) ? new ProviderHttp() : new SourceHttp();
