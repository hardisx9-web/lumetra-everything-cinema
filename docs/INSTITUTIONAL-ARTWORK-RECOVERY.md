# Existing institutional imagery recovery — 9 October 2026

## Result

This continuation did **not** bypass rights controls or republish the 14,470 legacy `media_asset` rows. It inspected every row, ran a provider-scoped rights/identity/health audit, and completed a resumable recovery review of all rows:

- Recovery run: `e8533312-d09c-4c21-82db-45daf736495e`
- Status: `COMPLETED`
- Checkpoint: 14,470 / 14,470
- Decisions: 14,470 `RIGHTS_BLOCKED_EXISTING_REFERENCE`
- Original Work/playback/ingestion rows and original media columns unchanged
- Existing serving coverage remains 9 distinct Works; no legacy institutional image was incorrectly published

This is an actual recovery improvement in integrity and resumability, not a claim of thousands of image publications. The previous approved serving result remains: **9 of 20,512 Works**, up from 4, comprising 5 posters, 3 stills and 1 production photograph. The nine approved rows are the separately reviewed Commons assets, including the DFI-sourced *Atlantis* poster. See `docs/artwork-coverage-after.json` and `docs/institutional-artwork-audit.json`.

## Provider-by-provider audit

| Provider | Existing asset rows | Distinct film IDs | Source metadata image URLs / Works | Health sample: reachable / blocked | Rights-approved rows | Published | Blocker |
|---|---:|---:|---:|---:|---:|---:|---|
| BFI Player | 10,158 | 10,158 | 10,158 / 10,158 | 189 / 0 | 0 | 0 | BFI terms reserve Site content; no per-image reuse licence/creator/attribution stored |
| NFB Canada | 1,956 | 1,447 | 2,187 / 1,429 | 26 / 4 | 0 | 0 | NFB terms require written licence for non-private use; no artwork permission stored |
| Mosfilm | 1,428 | 1,428 | 1,431 / 1,428 | 20 / 0 | 0 | 0 | Current `www.mosfilm.ru` agreement limits Materials to personal non-commercial use on one computer and requires special permission for other-site use |
| Cinémathèque française / HENRI | 410 | 410 | 455 / 410 | 4 / 0 | 0 | 0 | No item-level image licence in saved records; legal notice is not a blanket reuse grant |
| Retina Latina | 418 | 418 | 418 / 418 | 7 / 0 | 0 | 0 | No item-level image licence/creator/attribution; film viewing windows are not image permission |
| 35mm.online | 100 | 100 | 100 / 100 | 0 / 0 | 0 | 0 | No item-level licence/attribution; provider terms not established |

**Definitions:** “reachable” here is the limited earlier HTTP/content-type health sample, not full image decode or legal clearance. “Valid film match” is the stored ingestion Work association, not independent artwork-match review; because the source rows carry `SOURCE_RELATION_UNREVIEWED` and no artwork-specific evidence, they were not called verified matches. “Rights-approved” requires `license_verified=true`, `review_status=APPROVED`, and healthy image status. “Published” means a row in the versioned public artwork manifest.

The audit also found 13,961 distinct Works with any legacy media asset, but zero with item-level source/license/creator metadata sufficient for automatic publication. Existing records contain only provider/external-id/run metadata; none contain a rights grant. `source_page_url`/attribution are absent on all original institution rows. This is why adding an `image_url` check or marking all HTTP 200 records as cleared would be an erroneous exporter bypass.

## Policy evidence

- NFB Terms: https://help.nfb.ca/terms/ — content includes photographs/images; non-private reproduction/display/distribution requires express written permission. Existing rows use `assets.nfbcdn.ca/medias/norman/...`; `https://publicapi.nfb.ca` is a delivery/API mechanism, not a reuse licence. NFB Media Space (https://mediaspace.nfb.ca/) is limited to authorized media representatives and publicity, promotion, critical review or journalism; it does not clear the existing CDN rows.
- BFI Player Terms: https://player.bfi.org.uk/terms-of-use — clauses 2.1–2.4 reserve content rights; clauses 6.8 and 6.12 restrict viewing to personal/non-commercial use and prohibit copying, distribution, display, publication, licensing, scraping, data mining and extraction unless expressly authorized. Existing rows use responsive `/sites/default/files/styles/landscape_640x360/public/hero-images` paths; the internal search endpoint is not a public artwork feed. BFI's press/media FAQ routes film stills to distributors or the BFI stills team, without a blanket reuse grant.
- Mosfilm Terms: https://www.mosfilm.ru/user-agreement/ — current `www.mosfilm.ru` policy scope. It permits Materials only for personal, non-commercial use on one computer and prohibits copying, reproduction, republication, uploading, posting, transmission, distribution or use on another website/network without special permission. Existing image paths are under `www.mosfilm.ru/upload/iblock/...`; https://www.mosfilm.ru/contacts/ is a contact route, not a licence. A separate legacy Mosfilm subdomain policy is not used for this scope.
- Cinémathèque legal notice: https://www.cinematheque.fr/mentions-legales.html — identifies publisher; no blanket artwork reuse licence.
- Commons reuse policy, used for the nine approved assets: https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia — individual file rights control.
- LOC probe: `docs/artwork-provider-probes.json` records HTTP 403 for the authorized JSON attempt; no bypass.
- Europeana: API key absent; no request or image publication. TMDB remains disabled because commercial/destination use needs an applicable written agreement.

## What is technically and legally publishable now

The only automatically publishable institutional-adjacent asset is the independently reviewed DFI/Commons *Atlantis* file, because the Commons file has item-level CC BY 4.0 metadata, creator, source page, license URL, exact dated film category, and fully decoded local variants. The other eight approved images are separately reviewed Commons files with file-specific rights evidence. No NFB, BFI, Mosfilm, HENRI, Retina Latina or 35mm image is currently publishable from stored data alone.

## Next authorized recovery step

Obtain one of the following from each provider before moving any legacy row to `APPROVED`:

1. A written Lumetra artwork licence/feed permission naming the image classes, display/rehosting rights, territory, duration, attribution and source-page requirements; or
2. An item-level open licence/rights statement with creator, licence URL, source-page URL and confirmation that the image is film-specific; then independently verify exact Work identity and full image decode.

Once received, add a new immutable provider-scoped review run rather than altering historical ingestion snapshots. Preserve the original CDN URL and provider page; generate local variants only within the granted rights. Re-export and run the local HTTP/image smoke checks. Do not deploy until owner visual and rights approval.
