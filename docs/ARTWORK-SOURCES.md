# Artwork source and permission decisions

Research conducted 8–9 October 2026. An image URL, free-film viewing classification, HTTP 200, or open metadata record is **not** permission to republish an image. These are engineering publication gates, not a warranty of worldwide copyright clearance. Owner territory/use review remains necessary.

## Existing catalogue first

`docs/artwork-coverage-baseline.json` records 20,512 Works, 23,711 playback records, 3,883 eligible external sources and 2,975 watchable Works. The native PostgreSQL database has all **33,958 ingestion candidates**, unlike the previously documented partial PGlite restoration. No restore or reset was performed.

14,470 existing media references cover 13,961 Works, but all 14,470 have `license_verified=false`, `SOURCE_IMAGE_LICENSE_UNVERIFIED`. The exporter deliberately excluded these; this is the largest cause of missing images. The serving artwork table was empty and the frontend used only four bundled Commons records. There was also no API artwork join or broad image fallback/selection flow.

`artwork-inventory.mjs` scans every Work metadata object, playback metadata object, immutable ingestion candidate, and media asset recursively without downloading institutional images. `docs/artwork-source-inventory.json` reports paths and counts. BFI, NFB, Mosfilm, HENRI, Retina Latina and 35mm have existing references. Eye/DFI/NFAJ/NZ records examined have no saved image URLs; absence in this snapshot is not proof of absence at the provider. Some references are landscape stills despite the historical `POSTER` field. The original field is preserved; `artwork_type` stores separate, unreviewed classification.

## Institutional source gate

- **NFB:** https://help.nfb.ca/terms/ — expressly covers photographs, images and illustrations. The terms prohibit reproduction, display, uploading, distribution or other exploitation without express written permission; a viewing record or API result does not grant image rights. Existing image rows use the `assets.nfbcdn.ca/medias/norman/...` delivery host and the public API is `https://publicapi.nfb.ca`; neither is a licence. NFB Media Space (https://mediaspace.nfb.ca/) is a separate, narrow resource for authorized media representatives and publicity, promotion, critical review or journalism, not a blanket catalogue-rehosting grant. No NFB artwork published by this run. Obtain applicable written artwork/feed permission through https://help.nfb.ca/contact-the-nfb/.
- **BFI Player:** https://player.bfi.org.uk/terms-of-use — clauses 2.1–2.4 reserve rights, and clauses 6.8 and 6.12 limit viewing to personal/non-commercial use while prohibiting copying, display, publication, licensing, scraping, data mining and extraction unless expressly authorized. Existing rows use BFI Player responsive paths under `/sites/default/files/styles/landscape_640x360/public/hero-images`; these are display derivatives, not a licence. The exposed search endpoint (`https://search-es.player.bfi.org.uk/prod-films/_search`) is a technical service, not an artwork feed. The BFI press/media FAQ (https://www.bfi.org.uk/press-releases-media-enquiries/press-media-faq) routes film stills to the distributor or BFI stills team; it grants no blanket reuse right. 10,158 existing references remain blocked, not mass-published or redownloaded.
- **Mosfilm:** https://www.mosfilm.ru/user-agreement/ — the current main-site agreement permits Materials only for personal, non-commercial use on one computer, prohibits copying/republication/distribution or use on another website without special permission, and is the correct policy scope for the existing `www.mosfilm.ru/upload/iblock/...` image paths. https://www.mosfilm.ru/contacts/ is a contact route, not a reuse licence. No item-level film-image permission was found; the 1,428 rows remain blocked. Do not infer permission from film age, official site delivery or the agreement's promotion language.
- **Eye, HENRI, Retina Latina, 35mm:** no per-image open licence was found in the saved ingestion metadata. HENRI legal page https://www.cinematheque.fr/mentions-legales.html identifies the publisher but does not grant blanket artwork reuse. Eye's attempted `/en/terms-and-conditions` URL returned 404. These sources remain `PENDING_RIGHTS`, not assumed unavailable or public-domain. No playback source classification changed.

## Commons / MediaWiki — executed acquisition

- https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- https://commons.wikimedia.org/wiki/Commons:Licensing
- https://www.mediawiki.org/wiki/API:Imageinfo
- https://www.mediawiki.org/wiki/API:Etiquette
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy

The pipeline fetches `imageinfo` including original URL, MIME, dimensions, creator, file description, categories and extended licensing metadata. It accepts only explicit per-file Public Domain/CC0/CC BY/CC BY-SA statements, rejects NC/ND/unknown/conflicting rights and flagged US-copyright conflicts, and preserves the license URL and attribution. CC BY-SA images remain attributed under that same license; variants only resize/re-encode, with the changes recorded. Raw provider evidence is stored in `artwork_candidate` and accepted asset metadata. File pages provide jurisdiction-specific evidence; no blanket public-domain inference from release year is made.

**Identity:** exact dated film category or explicit title/year/director evidence plus a verified poster/still type; generic title substrings, first names, publicity events, fan art, books, remakes and ambiguous catalogue title/year identities cannot auto-publish. Multiple genuine pictures of the same positively identified film are alternatives, not multiple Works. Reviewed exceptions are exact work/title/year/director/file mappings in `catalogue-editorial/artwork-reviewed.json`, with evidence notes, and still must pass the independent license gate.

**Operations:** serial requests, at least 6.5 seconds between uncached same-host requests, meaningful user agent/contact URL, `maxlag=5`, cached responses, persisted provider cooldown and stop on 429/503/access denial. The earlier partial implementation issued 30 rate-limited requests and had a SQL bind bug; that historical failed run remains recorded. The repaired v2 runner does not repeat completed decisions and stops the batch on a throttle. No access-control bypass is used.

## Library of Congress — conservative discovery adapter

- https://www.loc.gov/apis/
- https://www.loc.gov/apis/json-and-yaml/requests/
- https://www.loc.gov/apis/json-and-yaml/working-within-limits/
- https://www.loc.gov/legal/
- https://www.loc.gov/free-to-use/

No key required. Documentation lists JSON/YAML 20 requests/minute, while general legal guidance recommends no more than 10/minute; implementation uses 6.5-second spacing. API hits/CAPTCHA/access denial must stop, not trigger bypasses. LOC does not own every item's rights: item-level rights and exact identity are required. The adapter records results for review, not automatic permission. The prior catalogue noted 403 access blocking. An execution observation is recorded separately in the run log/report.

## Europeana — gated discovery adapter

- https://api.europeana.eu/
- https://europeana.atlassian.net/wiki/spaces/EF/pages/2385313793/Europeana+APIs+Documentation
- https://europeana.atlassian.net/wiki/spaces/EF/pages/2360508417/Europeana+API+FAQ
- https://www.europeana.eu/rights/terms-of-use

Requires an owner-supplied API key (`EUROPEANA_API_KEY`), absent here. Metadata CC0 does not license images. `reusability=open` limits discovery to PDM/CC0/CC BY/CC BY-SA, but full item `edm:rights` and provider record still require review. Adapter returns review candidates only. No key or account was created and no unlicensed images were taken.

## Openverse — evaluated, not an automatic publisher

- https://docs.openverse.org/api/reference/authentication_and_throttling.html
- https://api.openverse.org/v1/images/

Useful secondary discovery index, but provider landing page is authoritative; stale/misclassified licenses and unrelated title matches are possible. NC/ND results must be excluded. Authentication/throttle tiers vary. Not used to bypass Commons/LOC throttling and not counted as executed enrichment.

## TMDB — not enabled

https://www.themoviedb.org/api-terms-of-use was read. Commercial/destination use needs the applicable separate written agreement; logo/notice attribution, six-month caching and other restrictions apply. Lumetra's qualifying use/permission and API key were not supplied. No TMDB scraping, downloads or image publication occurred. Broad modern-poster coverage will require an approved licensing/feed arrangement rather than weakening these gates.
