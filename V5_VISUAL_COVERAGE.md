# Lumetra V5 — Visual Coverage Edition

This is an actual source-code update to Lumetra V4, **not** a design mockup.

## What's new
- 675 original educational/editorial SVG assets shipped locally.
- Unique labeled image for each of the 250 technology item entries and 309 crew-role entries; covers for 17 technology families and 20 crew departments.
- 19 camera-era illustrations, with original historical photos preferred when present.
- 32 reusable film-mood illustrations selected deterministically by film ID. Every unillustrated film retains its unique title and metadata over the editorial visual.
- 16 essay/world editorial illustrations and 12 generic equipment-based people-profile illustrations, explicitly **not** portraits or verified photographs.
- Visuals are now wired into group indexes, item cards, details, film posters, essay listings and pages, World history, people profiles and museum objects.
- Existing vetted, approved original film art is still displayed before any illustrative fallback.

## Important distinction
No synthetic likeness is claimed to be a real filmmaker. The 675 images are labeled artistic/educational illustrations, not historically accurate photos of specific branded equipment or original film stills. Film mood designs repeat across the 20,512-record catalogue while text and metadata remain record-specific. A *genuine image for every film and individual* requires a separate licensed artwork/portrait acquisition and review pipeline.

## Preview on the Android phone
Download Lumetra-V5-Visual-Preview.zip in Downloads. Check that the download is complete; do not rename another file to .zip. In Termux:

```sh
mkdir -p ~/lumetra-v5-visual-preview
unzip -t /sdcard/Download/Lumetra-V5-Visual-Preview.zip | tail -1
unzip -oq /sdcard/Download/Lumetra-V5-Visual-Preview.zip -d ~/lumetra-v5-visual-preview
cd ~/lumetra-v5-visual-preview
PORT=4185 node scripts/preview-catalogue.mjs
```

Open `http://127.0.0.1:4185/technology`, `http://127.0.0.1:4185/crew`, `/discover`, `/world`, `/journal`. Keep Termux open.

## QA
- 599 technology/crew routes rendered in a controlled Node DOM-free check; all contained actual image tags, and every local image reference existed.
- 1,000 synthetic metadata film records tested for illustrated fallback.
- Existing learning/route/responsive/artwork tests passed after updating the intentionally changed artwork fallback expectation.
- Local HTTP preview served source paths and database API with HTTP 200.
- Browser screenshot testing could not be completed here because Chromium blocks both localhost and file URLs (`ERR_BLOCKED_BY_ADMINISTRATOR`). Actual device verification is still needed.
- Current legitimate playback verification has not been refreshed, and live Cloudflare hosting is unchanged.
