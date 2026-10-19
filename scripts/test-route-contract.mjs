import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync('public/shell.html', 'utf8');
const index = readFileSync('public/index.html', 'utf8');
const worker = readFileSync('build/sites-worker.ts', 'utf8');
const app = readFileSync('public/app.js', 'utf8');
const frameworkHome = readFileSync('app/page.tsx', 'utf8');

assert.equal(shell, index, 'the static shell and root fallback must stay identical');
for (const marker of ['id="site-header"', 'id="main"', 'id="intro"', 'id="horizon-nav"', 'id="menu-panel"']) {
  assert(shell.includes(marker), `shell is missing ${marker}`);
}
for (const path of [
  '/', '/discover', '/watch', '/film/', '/person/', '/world', '/journal',
  '/essay/', '/museum', '/about', '/corrections', '/technology', '/crew',
]) assert.match(app, new RegExp(`['"]${path.replace('/', '\\/')}`), `app route missing ${path}`);
assert.match(worker, /new URL\('\/shell\.html'/, 'Worker must serve the Lumetra shell for extensionless routes');
assert.match(frameworkHome, /redirect\("\/shell\.html"\)/, 'framework fallback must redirect to the Lumetra shell');
for (const marker of ['rel="canonical"', 'property="og:url"', 'name="twitter:title"', 'id="structured-data"']) {
  assert(shell.includes(marker), `shell needs ${marker} for route metadata`);
}
assert.match(app, /isLearningPath/, 'educational routes must be handled');
assert.match(app, /setHeadMeta\('og:url'/, 'client routes must update Open Graph URL metadata');
assert.match(app, /setStructuredData/, 'client routes must publish structured dossier metadata');
console.log('Route contract passed: shell, Worker fallback, framework fallback and client routes are aligned.');
