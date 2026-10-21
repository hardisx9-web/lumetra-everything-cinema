# Lumetra V4 — Cinema Technology & The Crew

This is an **isolated preview**, based on Lumetra V3. It is **not deployed** and does not modify the staging/production Worker, GitHub or original project.

## Native Android / Termux preview

1. Download `Lumetra-Learning-Preview-v4.zip` onto the phone which has Termux, and open Termux.
2. Run:

```sh
mkdir -p ~/lumetra-learning-preview-v4
unzip -oq /sdcard/Download/Lumetra-Learning-Preview-v4.zip -d ~/lumetra-learning-preview-v4
cd ~/lumetra-learning-preview-v4
PORT=4184 node scripts/preview-catalogue.mjs
```

3. On that same phone, open **http://127.0.0.1:4184/technology** for the technology museum, **http://127.0.0.1:4184/technology/cameras** for the camera history, or **http://127.0.0.1:4184/crew** for the searchable credit dictionary.
4. Keep Termux running. `Ctrl+C` stops only the preview server.

If port 4184 is busy, use `PORT=4185` and open that port instead. The opening video can be skipped to explore the sections.

## Reversibility

Your original source, V3 preview, GitHub and deployed site remain unchanged. V4 lives in its own preview directory. The source changes are packaged separately in `Lumetra-Learning-Source-v4.zip` and should only be merged after review.

## What is and isn't completed

- 17 technology disciplines, 250 basic technology descriptions; 19 camera milestones and 6 credited photo links with 13 original schematic fallbacks.
- 20 departments and 309 credits/variants; 26 expanded teaching profiles; searchable credits dictionary, 12-question interactive end-credits challenge and individual pages.
- The 309 entries are not all individually vetted long-form articles, and they are not a complete census of worldwide film-worker credits.
- Technology dates and claims are conservative; references and remaining gaps documented in `docs/CINEMA_LEARNING_RESEARCH.md`.
- Local component screenshots at 390px and 1440px were inspected; preview HTTP and automated route/structure tests pass.
- Full interactive browser test on live site, external Commons image load verification, accessibility review, and production builds remain outstanding.
