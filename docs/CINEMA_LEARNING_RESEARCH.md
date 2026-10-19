# Lumetra — Cinema Technology & The Crew | V4 Editorial Register

**Status:** Production-feature candidate / editorial beta. Reviewed 18 October 2026. **Not an exhaustive encyclopedia** and **not deployed**.

## Intended learning outcome
After viewing these sections, a curious viewer should be able to identify the departments that create a film; understand common closing-credit responsibilities; and trace major cinema technologies from early photographic motion to contemporary digital capture and exhibition. International, independent, studio and historical distinctions are part of the teaching, not an afterthought.

## Coverage snapshot

- **17 technology families** and **250 technology/device/method entries**. All have one-sentence descriptions; category introductions contain sourced editorial synthesis. Individual model/device research remains selective.
- **Camera timeline:** 19 milestones (1890s–present), with six named external historical camera photographs linked to original Wikimedia Commons attribution/licensing pages, plus original SVG schematic fallback art. Some models are represented by a *family photograph* clearly disclosed as such, not a misleading exact match.
- **20 crew departments**, **309 role-and-variant entries**, **26 source-linked teaching profiles**. Entries are not 309 distinct universal careers: the same title can belong in multiple contexts and many regional aliases are treated as variants.
- **Searchable role dictionary**, clickable department/index/detail routes, explanations of what common jobs do and do not do, typical on-set scenarios, links to sources, and a path to suggest omissions.

## Primary research references

1. National Science and Media Museum (Science Museum Group) — Lumière brothers, hand-cranked Cinématographe, intermittent transport: https://blog.scienceandmediamuseum.org.uk/the-lumiere-brothers-pioneers-of-cinema-and-colour-photography/
2. BFI / Sight and Sound — early cinema as concurrent and contested development: https://www.bfi.org.uk/sight-and-sound/features/origins-cinema-early-inventors-pioneers
3. National Science and Media Museum — Edison / Dickson, perforated stock and Kinetoscope: https://blog.scienceandmediamuseum.org.uk/celluloid-and-photography-part-3-the-beginnings-of-cinema/
4. ARRI — century of camera innovations, ARRIFLEX 35 (1937), 35BL (1972), ALEXA (2010), film and digital workflow: https://www.arri.com/en/company/the-arri-philosophy/history/the-history-of-arri-in-a-century-of-cinema
5. ARRI — lens mounts and digital lens-data interfaces: https://www.arri.com/en/learn/arri-camera-technology/lens-mounts-and-lds-2
6. Sony — VENICE design and HDW-F900/CineAlta history: https://www.sony.com/en/SonyInfo/design/stories/venice/
7. Kodak — chronological record of motion-picture stocks and processes: https://www.kodak.com/en/motion/page/chronology-of-film/
8. Academy of Motion Picture Arts and Sciences — historical technology collection: https://www.oscars.org/science-technology/technology-history
9. Academy — _Recording Sound for Motion Pictures_ (1931): https://www.oscars.org/science-technology/projects/recording-sound-motion-pictures
10. ScreenSkills — film/TV drama job profiles by department: https://www.screenskills.com/job-profiles/browse/film-and-tv-drama/
11. ScreenSkills — role/department occupational skills checklists: https://www.screenskills.com/skills-checklists/scripted-film-and-tv
12. ScreenSkills — DP responsibilities and associated camera team: https://www.screenskills.com/job-profiles/browse/film-and-tv-drama/technical/director-of-photography-dop/
13. ScreenSkills — post-production jobs: https://www.screenskills.com/job-profiles/browse/post-production/
14. ScreenSkills — visual effects jobs: https://www.screenskills.com/job-profiles/browse/visual-effects-vfx/
15. Motion Picture Association _The Credits_ — below-the-line worker interviews and role names: https://www.motionpictures.org/the-credits/interviews/

## Artwork and rights

The six external image candidates are drawn from Wikimedia Commons **specific file pages**. Each image displays descriptive alt text and a clickable image credit/license source. Paths and credit text reside in `public/learning-data.js`; the source page must be rechecked before production ingestion. The browser loads from Wikimedia Commons; if loading fails, an original SVG camera schematic replaces the image. This is not the same as claiming a historical photograph was successfully ingested or that it was independently copied to Lumetra.

Photographs selected: Lumière Cinématographe prototype (public-domain source), Mitchell Standard camera (CC BY-SA 4.0), Bolex H16 (public-domain source), Panavision camera family (CC BY-SA 4.0, *not asserted to be an exact Panaflex*), RED ONE (CC BY 3.0), ARRI ALEXA Plus (license information linked for verification). Avoid embedding or redistributing photograph files without a production rights and attribution audit.

## Self-review / risk matrix

| Check | Result | Release implication |
| --- | --- | --- |
| Camera history presents several early inventors rather than single origin | Reviewed | Pass |
| DoP versus operator, gaffer versus key grip, first AD versus co-director | Reviewed | Pass in source-linked profiles |
| Stunt double/dupe versus stand-in; best boy title | Reviewed with regional nuance | Pass as working introductions, not universal taxonomy |
| 17 technology chains, including exhibition, sound, animation and digital | Indexed | Deep model-by-model history pending |
| Preproduction, performance, stunt, VFX, craft, data, marketing, distribution roles | Indexed | Country/union-specialist audit pending |
| Hardware photographs in every camera milestone | 6 photo links; 13 schematics | **Not complete** |
| Regional credits: India, South Asia, Africa, Arab cinemas, East Asia, Latin America | Selected variants noted | **Specialist review pending** |
| Each of 309 role entries independently checked against guild/union source | No | **Not complete** |
| Camera launch year/model and technical specs individually verified | Only selected milestones | **Not complete** |
| Interaction testing on actual Android and live Cloudflare Worker | Not run | **Required before release** |
| Accessibility audit by screen reader and motor-device users | Not run | **Required before release** |

## How to grow without invisible omissions

Each entry should ultimately carry: canonical title, country/era variants, aliases, historical dates (if applicable), category, primary responsibilities, collaborations, how to recognize the craft, source URLs, source access date, image attribution/license, date of editorial review, reviewer, and 'verified/in-progress/needs-review' state.

A future research pass should systematically compare ScreenSkills department maps, occupational unions, national film-commission guides, union/guild credit descriptions, animation/VFX credits, end-title samples from productions across regional industries, and student-film/independent emerging roles. Collect titles missing in either database, distinguish synonyms from distinct jobs, and route proposed additions through moderation. The existing `/corrections` feature provides the entry point, subject to API availability.

## Known technical limitations

No live deployment was made; the V4 preview is local. The existing local catalogue snapshot is retained unchanged. No remote D1 or current watch source health was repaired by this feature. The legacy Chromium environment blocks local network navigation; static component rendering was tested using Playwright `set_content` with mobile and desktop viewport widths, but full end-to-end browser behavior still needs validation on a real device. All links and photo licenses need production smoke-testing against the hosted site.
