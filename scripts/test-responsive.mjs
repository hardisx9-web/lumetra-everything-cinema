import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync('public/shell.html', 'utf8');
const css = readFileSync('public/styles.css', 'utf8');
const app = readFileSync('public/app.js', 'utf8');
const bootstrap = readFileSync('public/bootstrap.js', 'utf8');

for (const marker of [
  'data-nav="watch"',
  'data-nav="technology"',
  'data-nav="crew"',
  'id="menu"',
  'id="horizon-nav"',
  'id="horizon-menu"',
  'id="menu-panel"',
  'aria-modal="true"',
  'aria-labelledby="theater-title"',
  'aria-describedby="intro-status"',
  'id="structured-data"',
]) assert(shell.includes(marker), `navigation contract is missing ${marker}`);
assert(shell.includes('href="/discover?artwork=1"'), 'Collections must open the verified-artwork catalogue view');

assert.match(css, /@media\(min-width:701px\)/, 'desktop navigation media query is required');
assert.match(css, /@media\(max-width:700px\)/, 'mobile navigation media query is required');
assert.match(css, /\.header #menu\{display:flex/, 'desktop must expose the matching menu control');
assert.match(css, /\.horizon-nav\{display:none!important\}/, 'desktop must not accidentally show mobile Horizon navigation');
assert.match(css, /\.menu-panel\{display:flex!important/, 'desktop must have a real menu-sheet presentation');
assert.match(css, /\.menu-open\{overflow:hidden\}/, 'open menu must lock background scrolling');
assert.match(css, /\.menu-panel\{position:fixed;z-index:100/, 'mobile menu must sit above the Horizon navigation');
assert.match(css, /@media\(min-width:701px\) and \(max-width:820px\)[\s\S]{0,100}\.header nav\{display:none\}/, 'compact desktop must avoid header navigation overflow');
assert.match(css, /@media\(max-aspect-ratio:1\/1\)/, 'portrait theater layout must use aspect ratio, not desktop-width detection');
assert.doesNotMatch(css, /@media\(min-width:701px\) and \(orientation:portrait\)/, 'old Android Desktop Site hybrid query must be gone');
assert.doesNotMatch(css, /@media\(min-width:701px\) and \(max-height:800px\)[\s\S]{0,240}\.universe-copy p\{display:none\}/, 'compact desktop must not hide the universe summary');

for (const marker of ['no-webgl', 'universe-fallback', 'world-reduced', 'prefers-reduced-motion']) {
  assert(css.includes(marker), `cinematic fallback/accessibility rule is missing ${marker}`);
}
for (const marker of ['createCinemaWorldRenderer', 'if (!renderer) root.classList.add(\'no-webgl\')', 'document.documentElement.classList.contains(\'reduced\')']) {
  assert(app.includes(marker), `runtime cinematic fallback marker is missing ${marker}`);
}
assert.match(bootstrap, /document\.documentElement\.classList\.add\('reduced'\)/, 'stored reduced-motion preference must apply before the opening film');
console.log('Responsive contract passed for mobile, Android Desktop Site-like, tablet and desktop CSS states.');
