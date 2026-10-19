import { subjectPhoto } from './subject-images.js';
import { subjectImages } from './subject-images.js';
import { isLearningPath, renderLearning } from './cinema-learning.js';
import { createCinemaHistoryChapters } from './cinema-home.js';
import { artworkFor, artworkLabel, filmTitle, filmMetadata, viewingStatus, posterMarkup, disjointProgramme, sessionProgrammeSeed, textureImageUrl, fallbackFilmImage } from './artwork-ui.js';
import { loadNotebook, writeNotebook, toggleNotebook, notebookJSON, importNotebook, validFilmId } from './my-cinema.js';

const main = document.querySelector('#main');
let editorial;
let artwork = {};
let statsData;
let programmingData;
let requestId = 0;
let programmeError = '';
let programmeBusy = false;
let currentSeed;
const programmingSeed = (reshuffle = false) => {
  const day = new Date().toISOString().slice(0, 10);
  if (!reshuffle && currentSeed?.startsWith(`${day}-`)) return currentSeed;
  let storage;
  try { storage = sessionStorage; } catch { /* storage is optional */ }
  currentSeed = sessionProgrammeSeed(storage, { day, reshuffle });
  return currentSeed;
};
let motionCleanup = () => {};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const safe = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? esc(parsed.href) : '';
  } catch {
    return '';
  }
};

const filmUrl = (id) => `/film/${encodeURIComponent(id)}`;
const api = async (path) => {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};
const defaultDescription = 'Enter a living universe of films, filmmakers, images and histories.';
function setHeadMeta(name, content, attribute = 'name') {
  const node = document.head.querySelector(`meta[${attribute}="${name}"]`);
  if (node && content) node.setAttribute('content', content);
}
function setStructuredData(data) {
  const node = document.head.querySelector('#structured-data');
  if (node) node.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
}
function title(value, description = defaultDescription, structured = {}) {
  const pageTitle = `${value} — Lumetra`;
  const canonicalUrl = new URL(`${location.pathname}${location.search}`, location.origin).href;
  document.title = pageTitle;
  setHeadMeta('description', description);
  setHeadMeta('og:title', pageTitle, 'property');
  setHeadMeta('og:description', description, 'property');
  setHeadMeta('og:url', canonicalUrl, 'property');
  setHeadMeta('twitter:title', pageTitle);
  setHeadMeta('twitter:description', description);
  const canonical = document.head.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = canonicalUrl;
  setStructuredData({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: value,
    description,
    url: canonicalUrl,
    ...structured,
  });
}

function poster(film, className = '') {
  return posterMarkup(film, artwork, className);
}

function notebookButton(kind, id, label, activeLabel) {
  if (!validFilmId(id)) return '';
  const active = loadNotebook()[kind].includes(id);
  return `<button type="button" class="notebook-button${active?' is-saved':''}" data-notebook-kind="${kind}" data-notebook-id="${esc(id)}" data-label-add="${esc(label)}" data-label-active="${esc(activeLabel)}" aria-pressed="${active}">${active ? esc(activeLabel) : esc(label)}</button>`;
}

function card(film, extra = '') {
  return `<article class="film-card ${extra}" data-reveal><a href="${filmUrl(film.id)}">${poster(film)}<h3>${esc(filmTitle(film))}</h3></a>${film.original_title && film.original_title !== filmTitle(film) ? `<p>${esc(film.original_title)}</p>` : ''}<p>${esc(filmMetadata(film))}</p><span class="badge">${esc(viewingStatus(film))}</span><div class="film-card-actions"><a class="film-action" href="${filmUrl(film.id)}">${film.watchable || film.embedded ? 'Viewing options & dossier' : 'Open dossier'} ↗</a>${notebookButton('saved',film.id,'+ Save','✓ Saved')}</div></article>`;
}

function essayCard(essay, usedFilms = new Set()) {
  const lead = (essay.films || []).map((id) => editorial?.films.find((film) => film.id === id)).find((film) => film && !usedFilms.has(film.id));
  if (lead) usedFilms.add(lead.id);
  const visual = lead ? `<a class="essay-card-film" href="${filmUrl(lead.id)}">${poster(lead)}<span>${esc(filmTitle(lead))} · Connected film ↗</span></a>` : `<div class="essay-card-visual essay-art-${esc(essay.room)}">${subjectPhoto('essay/'+essay.id,essay.title)}<span class="essay-art-ring"></span><span class="essay-art-line"></span><span class="essay-art-caption">LUMETRA / ${esc(essay.room)}</span></div>`;
  return `<article class="essay-card ${essay.editorial_status === 'RESEARCHED_DRAFT' ? 'essay-deep' : 'essay-intro'}" data-reveal>${visual}<span class="eyebrow">${esc(essay.room)} / ${esc(essay.period)}</span><h3>${esc(essay.title)}</h3><p>${esc(essay.deck)}</p><a href="/essay/${encodeURIComponent(essay.id)}">${essay.editorial_status === 'RESEARCHED_DRAFT' ? 'Read the researched feature' : 'Read introduction'} · ${esc(essay.reading)} ↗</a></article>`;
}

function imageFor(film, width = '640') {
  const image = artworkFor(film, artwork);
  return image?.variants?.[width] || image?.url || fallbackFilmImage(film);
}

function home() {
  title('Everything Cinema', defaultDescription, { '@type': 'WebSite', name: 'Lumetra' });
  const films = programmingData?.carousel || [];
  const chapters = createCinemaHistoryChapters(programmingData?.history || []);
  const fallbackCards = films.map((film, index) => `<a class="fallback-orbit-card orbit-${index + 1}" href="${filmUrl(film.id)}">${poster(film)}</a>`).join('');
  const filmstrip = [...films, ...films].map((film) => `<div class="filmstrip-frame" aria-hidden="true">${poster(film)}</div>`).join('');
  const programmeSection = (key, heading, link) => `<section class="cinema-section programme-section" aria-labelledby="programme-${key}"><div class="section-heading"><div><span class="eyebrow">THIS SESSION / THE LIVING CATALOGUE</span><h2 id="programme-${key}">${heading}</h2></div><a class="section-link" href="${link}">Explore more ↗</a></div>${programmingData?.[key]?.length ? `<div class="card-grid">${programmingData[key].map((film) => card(film)).join('')}</div>` : `<p class="notice">${programmingData ? 'No additional eligible works in this selection.' : 'Programme unavailable. Retry above to load catalogue works.'}</p>`}</section>`;

  main.innerHTML = `<div class="cinema-universe" data-cinema-universe>
    <section class="universe-journey" aria-label="An interactive journey through cinema history">
      <div class="universe-sticky">
        <canvas id="universe-canvas" class="universe-canvas" tabindex="0" aria-label="Interactive three-dimensional film world. Drag to move through the poster carousel; press space to pause."></canvas>
        <div class="universe-vignette" aria-hidden="true"></div>
        <div class="universe-topline"><span>LUMETRA / CINEMA UNIVERSE</span><span data-world-scene>SCENE 01 · THE MOTION MACHINE</span></div>
        <div class="universe-copy" aria-live="polite">
          <span class="universe-kicker" data-world-kicker>A LIVING UNIVERSE OF CINEMA</span>
          <h1><span data-world-title>Everything begins</span><br><em data-world-em>with light.</em></h1>
          <p data-world-summary>Move through the film world. The archive is not a shelf; it is a machine in motion.</p>
          <div class="universe-actions"><a class="cta" href="/discover">Enter the archive <span>↗</span></a><button class="universe-link" type="button" data-jump-history>Travel through time <span>↓</span></button></div>
        </div>
        <div class="programme-status" role="status" aria-live="polite" data-programme-status>${esc(programmeError || (films.length ? 'Programme loaded · reshuffle to discover another selection' : 'No carousel films available.'))}</div>
        <div class="universe-film-meta"><a data-world-film href="${films[0] ? filmUrl(films[0].id) : '/discover'}">${esc(films[0] ? filmTitle(films[0]) : 'Explore the catalogue')}</a><span data-world-details>${films[0] ? esc(filmMetadata(films[0])) : ''}</span><span data-world-viewing>${films[0] ? esc(viewingStatus(films[0])) : ''}</span><span data-world-artwork>${films[0] ? esc(artworkLabel(artworkFor(films[0], artwork))) : ''}</span><a class="film-action" data-world-action href="${films[0] ? filmUrl(films[0].id) : '/discover'}">${films[0]?.watchable || films[0]?.embedded ? 'Viewing options & dossier' : 'Open dossier'} ↗</a><span>FRAME <b data-world-frame>${films.length ? '01' : '00'}</b> / ${String(films.length).padStart(2, '0')}</span></div>
        <div class="universe-controls" aria-label="Film world controls"><button type="button" data-carousel-prev aria-label="Previous film" ${films.length ? '' : 'disabled'}>←</button><button type="button" data-carousel-pause aria-pressed="false" aria-label="Pause carousel" ${films.length ? '' : 'disabled'}>Pause</button><button type="button" data-carousel-next aria-label="Next film" ${films.length ? '' : 'disabled'}>→</button><button type="button" data-reshuffle aria-label="${programmeError ? 'Retry programme' : 'Reshuffle programme'}">↻</button></div>
        <div class="universe-fallback">${fallbackCards}</div>
        <div class="filmstrip-window" aria-hidden="true"><div class="filmstrip-track">${filmstrip}</div></div>
        <div class="universe-instruction"><span><i></i> DRAG THE REEL</span><span>SCROLL TO TRAVEL THROUGH TIME</span></div>
      </div>
      <div class="journey-chapters">
        <div class="journey-chapter chapter-opening" aria-hidden="true"></div>
        ${chapters.map((chapter, index) => `<article class="journey-chapter" data-chapter="${index}" aria-labelledby="chapter-title-${index}"><a class="chapter-visual" href="${filmUrl(chapter.id)}"><span class="chapter-frame">0${index + 1}</span>${poster(chapter.film)}</a><div class="chapter-copy"><span class="universe-kicker">${esc(chapter.kicker)}</span><h2 id="chapter-title-${index}">${esc(chapter.title)}</h2><p>${esc(chapter.text)}</p><a href="${filmUrl(chapter.id)}" class="chapter-link">${chapter.film.watchable || chapter.film.embedded ? 'Viewing options & dossier' : 'Open film dossier'} <span>↗</span></a></div></article>`).join('')}
      </div>
    </section>
    <section class="archive-threshold" aria-labelledby="threshold-title"><div class="threshold-art"><img src="/media/stage.png" alt="Lumetra projector, beam and filmmaking world artwork" width="1536" height="864" loading="lazy"></div><div class="threshold-copy"><span class="universe-kicker">THE ARCHIVE BEYOND THE SCREEN</span><h2 id="threshold-title">The picture<br><em>keeps opening.</em></h2><p>${statsData ? `${Number(statsData.works).toLocaleString()} catalogue works. ` : ''}Follow recorded films, evidence and viewing pathways through the archive.</p><a class="cta" href="/discover">Find your next frame <span>↗</span></a></div></section>
    <section class="launch-curation cinema-section" aria-labelledby="launch-curation-title">
      <div class="launch-curation-lead"><span class="eyebrow">THE LUMETRA DIFFERENCE</span><h2 id="launch-curation-title">Look closer.<br><em>Discover further.</em></h2><p>20,000+ catalogue records are a starting point, not a substitute for knowledge. Our research features trace evidence, technical choices and the lives of films beyond their first release.</p><a class="cta" href="/journal">Enter the reading room ↗</a><a class="cta ghost" href="/my-cinema">Open your cinema notebook ↗</a></div>
      <div class="launch-curation-reads">${editorial.essays.filter(e=>e.editorial_status==='RESEARCHED_DRAFT').slice(0,3).map((e,i)=>`<a class="launch-read launch-read-${i+1}" href="/essay/${encodeURIComponent(e.id)}"><span>RESEARCH / ${String(i+1).padStart(2,'0')}</span><strong>${esc(e.title)}</strong><small>${esc(e.reading)} · Documentary sources ↗</small></a>`).join('')}</div>
    </section>
    ${programmeSection('featured', 'Featured discoveries', '/discover')}
    ${programmeSection('watch', 'Verified viewing', '/watch')}
    ${programmeSection('collection', 'Across the collection', '/world')}
    <section class="learn-home-doors" aria-labelledby="learn-home-title"><div class="learn-home-lead"><span class="eyebrow">INSIDE THE MAKING OF MOVIES</span><h2 id="learn-home-title">Know what you see.<br><em>Know who made it.</em></h2><p>Follow the camera through cinema history, discover the technology behind each frame, and finally understand what hundreds of names in the closing credits did.</p></div><a href="/technology"><span>THE MACHINES</span><strong>Inside cinema technology</strong><i>Explore 17 disciplines ↗</i></a><a href="/crew"><span>THE PEOPLE</span><strong>Read the credits</strong><i>Explore 20 crew departments ↗</i></a></section><section class="archive-doors" aria-label="Cinema destinations"><a class="archive-door door-discover" href="/discover"><span>01 / THE CATALOGUE</span><strong>Find a film</strong><i>↗</i></a><a class="archive-door door-watch" href="/watch"><span>02 / THE VIEWING ROOM</span><strong>Watch what is verified</strong><i>↗</i></a><a class="archive-door door-stories" href="/journal"><span>03 / THE READING ROOM</span><strong>Follow the history</strong><i>↗</i></a></section>
  </div>`;
  initCinemaWorld(films, chapters);
}

function worldCards(compact = false) {
  const items = [
    { title: 'The first light', tag: '1890s—1920s / Early cinema', text: 'Tricks, actualities and the invention of collective dreaming.', link: '/essay/many-beginnings' },
    { title: 'The cut that thinks', tag: '1920s / Montage', text: 'Discover how meaning moves between images, bodies and cities.', link: '/essay/montage-as-thought' },
    { title: 'Across the frame', tag: 'Worlds / Many cinemas', text: 'Cross a border. Find another way of seeing.', link: '/essay/beyond-one-world-cinema' }
  ];
  return items.map((item) => `<article class="destination-card ${compact ? 'destination-compact' : ''}"><span class="destination-wash"></span>${subjectPhoto('destination/'+item.link,item.title)}<span class="eyebrow">${item.tag}</span><h3><a href="${item.link}">${item.title}</a></h3><p>${item.text}</p><a href="${item.link}">Enter this world ↗</a></article>`).join('');
}

function timeline(withImages = false) {
  const eras = [
    { year: '1890s', label: 'Motion becomes a spectacle', text: 'Viewing machines, actualities and the first rooms built around projected light.', id: 'many-beginnings' },
    { year: '1920s', label: 'The image learns to argue', text: 'Montage, documentary and experiments in cinematic perception.', id: 'montage-as-thought' },
    { year: '1940s', label: 'The street enters the frame', text: 'Postwar lives and the varied practices of Italian neorealism.', id: 'streets-of-neorealism' },
    { year: '1950s–60s', label: 'New waves, new possibilities', text: 'Criticism, independent production and a changing grammar of filmmaking.', id: 'new-wave-new-grammar' },
  ];
  return eras.map((era, index) => `<article class="era ${withImages ? 'era-cinematic' : ''}" data-reveal>${subjectPhoto('essay/'+era.id,era.label)}<span class="era-number">0${index + 1}</span><strong>${era.year}</strong><h3><a href="/essay/${era.id}">${era.label} ↗</a></h3><p>${era.text}</p></article>`).join('');
}

function createCinemaWorldRenderer(canvas, films) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec2 aUv;
    uniform mat4 uProjection;
    uniform vec3 uPosition;
    uniform vec2 uScale;
    uniform float uRotation;
    uniform vec2 uCamera;
    varying vec2 vUv;
    void main() {
      vec3 point = aPosition;
      point.xy *= uScale;
      float c = cos(uRotation);
      float s = sin(uRotation);
      float rotatedX = point.x * c - point.z * s;
      float rotatedZ = point.x * s + point.z * c;
      point.x = rotatedX + uPosition.x - uCamera.x;
      point.y += uPosition.y - uCamera.y;
      point.z = rotatedZ + uPosition.z;
      vUv = aUv;
      gl_Position = uProjection * vec4(point, 1.0);
    }
  `;
  const imageFragmentSource = `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uBrightness;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
      vec4 image = texture2D(uTexture, vUv);
      float edge = smoothstep(0.0, 0.045, vUv.x) * (1.0 - smoothstep(0.955, 1.0, vUv.x)) * smoothstep(0.0, 0.045, vUv.y) * (1.0 - smoothstep(0.955, 1.0, vUv.y));
      vec3 film = image.rgb * (uBrightness + edge * 0.12);
      gl_FragColor = vec4(film, image.a * uOpacity);
    }
  `;
  const backgroundVertexSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
  `;
  const backgroundFragmentSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec2 uPointer;
    uniform float uJourney;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) { return noise(p) * .55 + noise(p * 2.0) * .27 + noise(p * 4.0) * .13 + noise(p * 8.0) * .05; }
    void main() {
      vec2 uv = vUv;
      vec2 p = uv - .5;
      p.x *= uResolution.x / max(1.0, uResolution.y);
      float drift = uTime * .012;
      float fog = fbm(uv * vec2(2.5, 3.4) + vec2(drift, -drift * .7));
      float beamAxis = p.x + p.y * .3 - uPointer.x * .12;
      float beam = (1.0 - smoothstep(.015, .42, abs(beamAxis))) * (1.0 - smoothstep(-.45, .8, p.y));
      float cone = 1.0 - smoothstep(.05, .85, length(p * vec2(.65, .9)));
      float halo = 1.0 - smoothstep(0.0, .82, length(p * vec2(.8, 1.1)));
      vec3 deep = mix(vec3(.015, .025, .032), vec3(.04, .12, .14), fog * .75);
      vec3 era = mix(vec3(.05, .18, .22), vec3(.25, .08, .04), clamp(uJourney, 0.0, 1.0));
      vec3 color = deep + era * halo * .32 + vec3(1.0, .52, .18) * beam * cone * (.35 + fog * .42);
      float grain = noise(uv * uResolution * .025 + uTime) * .035;
      gl_FragColor = vec4(color + grain, 1.0);
    }
  `;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  };
  const link = (vertex, fragment) => {
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
  };
  const imageProgram = link(vertexSource, imageFragmentSource);
  const backgroundProgram = link(backgroundVertexSource, backgroundFragmentSource);
  if (!imageProgram || !backgroundProgram) return null;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -.5, -.5, 0, 0, 0, .5, -.5, 0, 1, 0, -.5, .5, 0, 0, 1, .5, .5, 0, 1, 1,
  ]), gl.STATIC_DRAW);
  const backgroundQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, backgroundQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const get = (program, name) => gl.getUniformLocation(program, name);
  const imageLocations = { position: gl.getAttribLocation(imageProgram, 'aPosition'), uv: gl.getAttribLocation(imageProgram, 'aUv'), projection: get(imageProgram, 'uProjection'), position3: get(imageProgram, 'uPosition'), scale: get(imageProgram, 'uScale'), rotation: get(imageProgram, 'uRotation'), camera: get(imageProgram, 'uCamera'), texture: get(imageProgram, 'uTexture'), brightness: get(imageProgram, 'uBrightness'), opacity: get(imageProgram, 'uOpacity') };
  const backgroundLocations = { position: gl.getAttribLocation(backgroundProgram, 'aPosition'), resolution: get(backgroundProgram, 'uResolution'), time: get(backgroundProgram, 'uTime'), pointer: get(backgroundProgram, 'uPointer'), journey: get(backgroundProgram, 'uJourney') };
  const placeholder = new Uint8Array([18, 26, 29, 255]);
  const texture = (url, film = null) => {
    const value = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, placeholder);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const upload = (source) => {
      if (gl.isContextLost()) return;
      gl.bindTexture(gl.TEXTURE_2D, value); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    };
    if (film) {
      const fallback = document.createElement('canvas'); fallback.width = 640; fallback.height = 960;
      const context = fallback.getContext('2d');
      if (context) {
        // A dedicated film-specific editorial illustration, never a substitute historical still.
        let seed = 2166136261;
        for (const chr of String(film.id || filmTitle(film))) seed = Math.imul(seed ^ chr.charCodeAt(0), 16777619) >>> 0;
        const palettes = [['#172c34','#d5a96b'],['#28273b','#c3acd6'],['#183d3b','#a5c4b3'],['#4a302e','#e5b69b']];
        const [back,accent] = palettes[seed % palettes.length];
        const grad = context.createLinearGradient(0,0,640,960);
        grad.addColorStop(0,back);grad.addColorStop(1,'#080e14');
        context.fillStyle=grad;context.fillRect(0,0,640,960);
        context.strokeStyle=accent;context.globalAlpha=.65;
        context.lineWidth=4;
        for(let r=110;r<440;r+=46){context.beginPath();context.ellipse(335,300,r,r*.72,(seed%13)*.1,0,Math.PI*2);context.stroke();}
        context.globalAlpha=1;
        context.fillStyle='#0b1115bb';context.fillRect(0,520,640,440);
        context.fillStyle = '#e5c48c'; context.font = '20px sans-serif'; context.fillText('LUMETRA / CATALOGUE', 44, 80);
        context.font = '48px serif';
        let line = ''; let y = 280;
        for (const word of filmTitle(film).split(/\s+/)) {
          if (line && context.measureText(`${line} ${word}`).width > 550) { context.fillText(line, 44, y, 550); y += 58; line = ''; }
          line += `${line ? ' ' : ''}${word}`;
        }
        context.fillText(line, 44, y, 550);
        context.font = '23px sans-serif'; context.fillText(String(film.year || 'Date unresolved'), 44, 745);
        context.fillText(film.director || 'Filmmaker unresolved', 44, 783, 550);
        context.font = '18px sans-serif'; context.fillText('ORIGINAL LUMETRA ILLUSTRATIVE COVER', 44, 860);
        context.fillText('NOT A HISTORICAL POSTER', 44, 888);
        upload(fallback);
      }
    }
    const localUrl = textureImageUrl(url, location.origin);
    if (!localUrl) return value;
    const image = new Image(); image.crossOrigin = 'anonymous'; image.decoding = 'async';
    image.onload = () => {
      if (gl.isContextLost()) return;
      try {
        // The scenic stage keeps its original landscape pixels and aspect ratio.
        if (!film) { upload(image); return; }
        const surface = document.createElement('canvas'); surface.width = 640; surface.height = 960;
        const context = surface.getContext('2d'); if (!context) return;
        context.fillStyle = '#111719'; context.fillRect(0, 0, 640, 960);
        const scale = Math.min(640 / image.naturalWidth, 960 / image.naturalHeight);
        const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
        context.drawImage(image, (640 - width) / 2, (960 - height) / 2, width, height);
        upload(surface);
      } catch { /* keep the already-uploaded, film-specific title treatment */ }
    };
    image.onerror = () => { /* keep the title treatment, never a blank or another film */ };
    image.src = localUrl;
    return value;
  };
  const screenTexture = texture('/media/stage.png');
  const filmTextures = films.map((film) => texture(imageFor(film, '960'), film));
  let width = 1;
  let height = 1;
  let history = 0;
  let pointer = { x: 0, y: 0 };
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
  };
  const projection = (aspect) => {
    const fov = 1.02;
    const near = .1;
    const far = 30;
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
  };
  const drawImage = (textureValue, matrix, position, scale, rotation, camera, brightness, opacity) => {
    gl.useProgram(imageProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(imageLocations.position); gl.vertexAttribPointer(imageLocations.position, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(imageLocations.uv); gl.vertexAttribPointer(imageLocations.uv, 2, gl.FLOAT, false, 20, 12);
    gl.uniformMatrix4fv(imageLocations.projection, false, matrix); gl.uniform3f(imageLocations.position3, position[0], position[1], position[2]); gl.uniform2f(imageLocations.scale, scale[0], scale[1]); gl.uniform1f(imageLocations.rotation, rotation); gl.uniform2f(imageLocations.camera, camera[0], camera[1]); gl.uniform1f(imageLocations.brightness, brightness); gl.uniform1f(imageLocations.opacity, opacity);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textureValue); gl.uniform1i(imageLocations.texture, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  const draw = (time, state) => {
    resize();
    const matrix = projection(width / height);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(backgroundProgram); gl.bindBuffer(gl.ARRAY_BUFFER, backgroundQuad); gl.enableVertexAttribArray(backgroundLocations.position); gl.vertexAttribPointer(backgroundLocations.position, 2, gl.FLOAT, false, 0, 0); gl.uniform2f(backgroundLocations.resolution, width, height); gl.uniform1f(backgroundLocations.time, time / 1000); gl.uniform2f(backgroundLocations.pointer, pointer.x, pointer.y); gl.uniform1f(backgroundLocations.journey, history); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const camera = [state.cameraX, state.cameraY];
    drawImage(screenTexture, matrix, [0, .38, -5.3], [7.4, 4.16], 0, camera, .72, .92);
    const cards = films.map((film, index) => {
      let relative = index - state.offset;
      relative = ((relative + films.length / 2) % films.length + films.length) % films.length - films.length / 2;
      const angle = relative * .52;
      return { index, relative, angle, x: Math.sin(angle) * 3.15, z: -1.0 - Math.cos(angle) * 1.22 };
    }).sort((a, b) => a.z - b.z);
    cards.forEach((card) => { const distance = Math.min(2.1, Math.abs(card.relative)); const size = 1.26 - distance * .1; drawImage(filmTextures[card.index], matrix, [card.x, .25 + distance * .08, card.z], [1.34 * size, 2.0 * size], -card.angle * .86, camera, .58 + (1 - distance / 2.1) * .4, .96); });
  };
  return {
    draw,
    setHistory(value) { history = value; },
    setPointer(value) { pointer = value; },
    destroy() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

function initCinemaWorld(films, chapters) {
  motionCleanup();
  const root = main.querySelector('[data-cinema-universe]');
  const canvas = root?.querySelector('#universe-canvas');
  if (!root || !canvas) return;
  const reduced = () => document.documentElement.classList.contains('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer = null;
  try { renderer = createCinemaWorldRenderer(canvas, films); } catch { /* DOM posters remain usable without WebGL */ }
  if (!renderer) root.classList.add('no-webgl');
  if (reduced()) root.classList.add('world-reduced');
  const state = { offset: 0, paused: false, dragging: false, startOffset: 0, startX: 0, cameraX: 0, cameraY: 0, targetCameraX: 0, targetCameraY: 0, resumeAt: 0, frame: 0, alive: true, dirty: true, last: performance.now(), history: 0 };
  const sceneNode = root.querySelector('[data-world-scene]');
  const filmNode = root.querySelector('[data-world-film]');
  const detailsNode = root.querySelector('[data-world-details]');
  const viewingNode = root.querySelector('[data-world-viewing]');
  const artworkNode = root.querySelector('[data-world-artwork]');
  const actionNode = root.querySelector('[data-world-action]');
  const frameNode = root.querySelector('[data-world-frame]');
  const track = root.querySelector('.filmstrip-track');
  const pauseButton = root.querySelector('[data-carousel-pause]');
  let selected = -1;
  let chapter = -1;
  const mod = (value, length) => ((value % length) + length) % length;
  const schedule = () => { if (!state.frame) state.frame = requestAnimationFrame(render); };
  const render = (now) => {
    state.frame = 0;
    if (!state.alive) return;
    const delta = Math.min(.05, Math.max(0, (now - state.last) / 1000));
    state.last = now;
    if (!state.paused && !state.dragging && !reduced() && now > state.resumeAt) state.offset += delta * .085;
    state.cameraX += (state.targetCameraX - state.cameraX) * .08;
    state.cameraY += (state.targetCameraY - state.cameraY) * .08;
    if (renderer) { renderer.setPointer({ x: state.targetCameraX, y: state.targetCameraY }); renderer.setHistory(state.history); renderer.draw(now, state); }
    const active = mod(Math.round(state.offset), films.length);
    if (films.length && active !== selected) {
      selected = active;
      const film = films[active];
      filmNode.textContent = filmTitle(film); filmNode.href = filmUrl(film.id);
      detailsNode.textContent = filmMetadata(film); viewingNode.textContent = viewingStatus(film);
      artworkNode.textContent = artworkLabel(artworkFor(film, artwork));
      actionNode.href = filmUrl(film.id); actionNode.textContent = `${film.watchable || film.embedded ? 'Viewing options & dossier' : 'Open dossier'} ↗`;
      frameNode.textContent = String(active + 1).padStart(2, '0');
    }
    if (films.length) track?.style.setProperty('--filmstrip-offset', `${-(state.offset * 112) % (films.length * 112)}px`);
    root.style.setProperty('--carousel-turn', state.offset.toFixed(3));
    state.dirty = false;
    if (!reduced() || state.dirty) schedule();
  };
  const wake = () => { state.dirty = true; schedule(); };
  const motionObserver = 'MutationObserver' in window ? new MutationObserver(() => { root.classList.toggle('world-reduced', reduced()); wake(); }) : null;
  motionObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const updateChapter = () => {
    const journey = root.querySelector('.universe-journey');
    const progress = Math.max(0, Math.min(1, -journey.getBoundingClientRect().top / Math.max(1, journey.offsetHeight - innerHeight)));
    state.history = progress;
    const nextChapter = Math.min(chapters.length - 1, Math.floor(progress * (chapters.length + 1)) - 1);
    root.classList.toggle('in-history', nextChapter >= 0);
    root.style.setProperty('--journey-progress', progress.toFixed(3));
    chapters.forEach((item, index) => root.querySelector(`[data-chapter="${index}"]`)?.classList.toggle('chapter-active', index === nextChapter));
    if (nextChapter !== chapter) {
      chapter = nextChapter;
      const item = chapters[chapter];
      sceneNode.textContent = item ? `CATALOGUE ENCOUNTER ${String(chapter + 1).padStart(2, '0')} · ${item.film.year || 'DATE UNRESOLVED'}` : 'SCENE 01 · THE MOTION MACHINE';
    }
    wake();
  };
  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    state.targetCameraX = reduced() ? 0 : ((event.clientX - rect.left) / rect.width - .5) * .5;
    state.targetCameraY = reduced() ? 0 : ((event.clientY - rect.top) / rect.height - .5) * -.32;
    wake();
  };
  const down = (event) => { state.dragging = true; state.startX = event.clientX; state.startOffset = state.offset; state.resumeAt = Number.POSITIVE_INFINITY; canvas.setPointerCapture?.(event.pointerId); root.classList.add('is-dragging'); wake(); };
  const move = (event) => { updatePointer(event); if (state.dragging) { state.offset = state.startOffset - ((event.clientX - state.startX) / Math.max(1, canvas.clientWidth)) * 2.8; wake(); } };
  const up = (event) => { state.dragging = false; state.resumeAt = performance.now() + 1800; root.classList.remove('is-dragging'); canvas.releasePointerCapture?.(event.pointerId); wake(); };
  const togglePause = () => { state.paused = !state.paused; pauseButton.textContent = state.paused ? 'Play' : 'Pause'; pauseButton.setAttribute('aria-pressed', String(state.paused)); root.classList.toggle('is-paused', state.paused); wake(); };
  canvas.addEventListener('pointerdown', down, { passive: true }); canvas.addEventListener('pointermove', move, { passive: true }); canvas.addEventListener('pointerup', up, { passive: true }); canvas.addEventListener('pointercancel', up, { passive: true }); canvas.addEventListener('pointerleave', () => { if (!state.dragging) { state.targetCameraX *= .82; state.targetCameraY *= .82; wake(); } }, { passive: true });
  canvas.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft') { state.offset -= 1; wake(); } if (event.key === 'ArrowRight') { state.offset += 1; wake(); } if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); togglePause(); } });
  root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => { state.offset -= 1; state.resumeAt = performance.now() + 2200; wake(); });
  root.querySelector('[data-carousel-next]')?.addEventListener('click', () => { state.offset += 1; state.resumeAt = performance.now() + 2200; wake(); });
  pauseButton?.addEventListener('click', togglePause);
  root.querySelector('[data-jump-history]')?.addEventListener('click', () => root.querySelector('[data-chapter="0"]')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }));
  window.addEventListener('scroll', updateChapter, { passive: true });
  window.addEventListener('resize', wake, { passive: true });
  updateChapter();
  schedule();
  motionCleanup = () => { state.alive = false; if (state.frame) cancelAnimationFrame(state.frame); motionObserver?.disconnect(); renderer?.destroy(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); window.removeEventListener('scroll', updateChapter); window.removeEventListener('resize', wake); };
}

async function discover(watch = false) {
  title(watch ? 'Verified viewing' : 'Discover films', watch
    ? 'Browse films with currently verified official viewing pathways, subject to date and territory.'
    : 'Search the Lumetra film catalogue by title, alternate title, filmmaker, country and year.');
  const url = new URL(location.href);
  const q = url.searchParams.get('q') || '';
  const country = url.searchParams.get('country') || '';
  const year = url.searchParams.get('year') || '';
  const genre = url.searchParams.get('genre') || '';
  const language = url.searchParams.get('language') || '';
  const page = url.searchParams.get('page') || '1';
  const artworkOnly = url.searchParams.get('artwork') === '1';
  main.innerHTML = `<section class="page-head"><span class="eyebrow">${watch ? 'The official viewing room' : 'The living catalogue'}</span><h1 class="page-title">${watch ? 'Find a film to watch.' : 'Your next discovery begins here.'}</h1><p>${watch ? 'Only sources passing the inherited verification gate appear here. Availability can change by date and territory.' : 'Search the restored catalogue by title, alternate title or filmmaker. A catalogue record does not establish free playback.'}</p><form class="search-form" id="search-form"><label class="sr-only" for="q">Title or filmmaker</label><input id="q" name="q" placeholder="Search films, alternate titles, filmmakers…" value="${esc(q)}" maxlength="160"><select name="country" aria-label="Country"><option value="">All countries</option></select><select name="year" aria-label="Year"><option value="">All years</option></select><select name="genre" aria-label="Genre or format"><option value="">All genres</option></select><select name="language" aria-label="Language as catalogued"><option value="">All languages</option></select><button class="cta" type="submit">Search ↗</button><label class="artwork-filter"><input type="checkbox" name="artwork" value="1" ${artworkOnly ? 'checked' : ''}> With verified artwork</label></form>${watch ? `<div class="verified-sources"><strong>Film archives worth exploring</strong><p>These are official institutions, not claims that a particular title is free to stream today.</p><a href="https://www.nfb.ca/" rel="noopener noreferrer" target="_blank">National Film Board of Canada ↗</a><a href="https://www.bfi.org.uk/bfi-player" rel="noopener noreferrer" target="_blank">BFI Player ↗</a><a href="https://www.film-foundation.org/world-cinema" rel="noopener noreferrer" target="_blank">World Cinema Project / restoration ↗</a></div>` : ''}<div id="result-status" class="results-count" role="status">Searching the database…</div></section><section class="cinema-section" id="results"></section>`;
  const form = document.querySelector('#search-form');
  form.onsubmit = (event) => { event.preventDefault(); const params = new URLSearchParams(new FormData(form)); for (const [key, value] of [...params]) if (!value) params.delete(key); navigate(`${watch ? '/watch' : '/discover'}${params.size ? `?${params}` : ''}`); };
  const token = requestId;
  try {
    const [facets, result] = await Promise.all([api('/api/facets'), api(`/api/films?${new URLSearchParams({ q, country, year, genre, language, page, ...(artworkOnly ? { artwork: '1' } : {}), ...(watch ? { watch: '1' } : {}) })}`)]);
    if (token !== requestId) return;
    for (const [name, list, selected] of [['country', facets.countries, country], ['year', facets.years, year], ['genre', facets.genres || [], genre], ['language', facets.languages || [], language]]) form.elements[name].insertAdjacentHTML('beforeend', list.map((value) => `<option value="${esc(value)}" ${String(value) === selected ? 'selected' : ''}>${esc(value)}</option>`).join(''));
    document.querySelector('#result-status').textContent = `${result.total.toLocaleString()} results · page ${result.page} of ${Math.max(1, Math.ceil(result.total / result.limit))}`;
    const pages = Math.ceil(result.total / result.limit);
    const pageUrl = (number) => { const params = new URLSearchParams(url.search); params.set('page', number); return `${url.pathname}?${params}`; };
    document.querySelector('#results').innerHTML = result.items.length ? `<div class="card-grid">${result.items.map((film) => card(film)).join('')}</div><div class="pagination">${result.page > 1 ? `<a class="cta ghost" href="${esc(pageUrl(result.page - 1))}">← Previous</a>` : ''}<span>Page ${result.page}</span>${result.page < pages ? `<a class="cta ghost" href="${esc(pageUrl(result.page + 1))}">Next →</a>` : ''}</div>` : '<p>No matching catalogue records. Try a different title or filter.</p>';
  } catch (error) {
    if (token !== requestId) return;
    document.querySelector('#result-status').textContent = 'Search unavailable';
    document.querySelector('#results').innerHTML = `<div class="error">${esc(error.message)}. The catalogue has not been replaced with demo results.<br><button id="retry">Retry database search</button></div>`;
    document.querySelector('#retry').onclick = () => render();
  }
}

async function film(id) {
  title('Film dossier');
  main.innerHTML = '<div class="loading" role="status">Opening the dossier…</div>';
  const token = requestId;
  try {
    const filmRecord = await api(`/api/films/${encodeURIComponent(id)}`);
    if (token !== requestId) return;
    const image = artworkFor(filmRecord, artwork);
    title(filmTitle(filmRecord), `${filmTitle(filmRecord)} — ${filmMetadata(filmRecord)}. ${viewingStatus(filmRecord)}.`, {
      '@type': 'Movie',
      ...(filmRecord.year ? { dateCreated: String(filmRecord.year) } : {}),
      ...(filmRecord.director ? { director: { '@type': 'Person', name: filmRecord.director } } : {}),
      ...(image?.url ? { image: new URL(image.url, location.origin).href } : {}),
    });
    const editorialRecord = filmRecord.editorial;
    main.innerHTML = `<article class="dossier"><a href="/discover" class="eyebrow">← Film catalogue</a><div class="dossier-top">${poster(filmRecord)}<div><span class="eyebrow">${esc(filmRecord.verification_level)} / Catalogue evidence</span><h1>${esc(filmTitle(filmRecord))}</h1>${filmRecord.original_title && filmRecord.original_title !== filmTitle(filmRecord) ? `<p>${esc(filmRecord.original_title)}</p>` : ''}<dl><dt>Year</dt><dd>${esc(filmRecord.year || 'Unresolved')}</dd><dt>Filmmaker</dt><dd>${filmRecord.director ? `<a href="/person/${encodeURIComponent(filmRecord.director)}">${esc(filmRecord.director)} ↗</a>` : 'Unresolved'}</dd><dt>Countries</dt><dd>${(filmRecord.countries || []).map((country) => `<a href="/discover?country=${encodeURIComponent(country)}">${esc(country)}</a>`).join(' · ') || 'Unresolved'}</dd>${filmRecord.alternate_titles?.length ? `<dt>Alternate titles</dt><dd>${filmRecord.alternate_titles.slice(0,6).map(esc).join(' · ')}</dd>` : ''}${filmRecord.languages?.length ? `<dt>Language labels</dt><dd>${filmRecord.languages.slice(0,6).map(esc).join(' · ')} <small>· As recorded by catalogue sources</small></dd>` : ''}${filmRecord.genres?.length ? `<dt>Genres & formats</dt><dd>${filmRecord.genres.slice(0,8).map(esc).join(' · ')} <small>· Catalogue labels, not an independent review</small></dd>` : ''}<dt>Runtime</dt><dd>${filmRecord.runtime ? `${Number(filmRecord.runtime).toFixed(1)} min · source record` : 'Unresolved'}</dd></dl>${notebookButton('saved',filmRecord.id,'+ Save to My Cinema','✓ Saved to My Cinema')} ${notebookButton('watched',filmRecord.id,'Mark watched','✓ Watched')}<span class="badge">${filmRecord.embedded ? 'VERIFIED EMBED' : filmRecord.watchable ? 'OFFICIAL EXTERNAL VIEWING' : 'NO CURRENT VERIFIED FREE PLAYBACK'}</span></div></div>${editorialRecord ? `<h2>The film</h2><p>${esc(editorialRecord.synopsis)}</p><h2>Context & form</h2><p>${esc(editorialRecord.significance)}</p><p>${esc(editorialRecord.programmeNote)}</p><p class="notice">Inherited editorial interpretation · references require renewed review. This prose is distinct from database-verified playback.</p>` : `<h2>About this record</h2><p>This dossier currently contains source-derived catalogue metadata. A researched synopsis, cast and crew, production history, reception, awards and restoration evidence have not yet been approved.</p>`}${filmRecord.research ? `<section class="dossier-research"><span class="eyebrow">DEEPER CONTEXT / SOURCE-LINKED EDITORIAL</span><h2>${esc(filmRecord.research.heading)}</h2>${filmRecord.research.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}<p class="notice">Research synthesis with linked institutional evidence. Interpretive context, not a firsthand film review.</p><div class="dossier-research-sources"><span class="eyebrow">RESEARCH TRAIL</span>${filmRecord.research.sources.map(s=>`<a href="${safe(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a>`).join('')}</div>${filmRecord.research.crossEssay ? `<a class="cta ghost" href="/essay/${encodeURIComponent(filmRecord.research.crossEssay)}">Read the complete research feature ↗</a>` : ''}</section>` : ''}<h2>Viewing & editions</h2>${filmRecord.sources.length ? filmRecord.sources.map((source) => `<div class="source"><strong>${esc(source.source_owner)}</strong> · ${esc(source.watch_state === 'WATCH_HERE' ? 'Embedding verified' : 'Official external viewing')}<small>Checked ${esc(new Date(source.last_checked_at).toLocaleString())} · ${esc(source.territories?.join(', ') || 'Territory restrictions not specified')}<br>${esc(source.version_or_restoration || 'Edition details unresolved')}</small><a class="cta ghost" href="${safe(source.external_watch_url || source.canonical_source_url)}" target="_blank" rel="noopener noreferrer">Watch at Official Source ↗</a></div>`).join('') : '<p>No source currently passes the publication gate. Links below are evidence records and are not presented as playable films.</p>'}<h2>Evidence trail</h2>${[...(editorialRecord?.sources || []).map((source) => ({ source_owner: source.label, canonical_source_url: source.url })), ...filmRecord.evidence].map((source) => `<a class="source" href="${safe(source.canonical_source_url)}" target="_blank" rel="noopener noreferrer">${esc(source.source_owner)} ↗<small>${esc(source.canonical_source_url)}${source.last_checked_at ? `<br>Last recorded check: ${esc(source.last_checked_at)}` : ''}</small></a>`).join('') || '<p>No public evidence URL is available in this record.</p>'}${image ? `<h2>Image provenance</h2><dl><dt>Image type</dt><dd>${esc(artworkLabel(image))} (${esc(image.artwork_type || 'Unspecified')})</dd><dt>Attribution</dt><dd>${esc(image.attribution)}</dd><dt>Provider</dt><dd>${esc(image.provider || 'Not recorded')}</dd><dt>License</dt><dd><a href="${safe(image.license_url)}" target="_blank" rel="noopener noreferrer">${esc(image.license)} ↗</a><br>${esc(image.license_url)}</dd><dt>Verified</dt><dd>${esc(image.verified_at)}</dd></dl><a class="source" href="${safe(image.source_page)}" target="_blank" rel="noopener noreferrer">Source file and rights statement ↗</a>` : '<p class="notice">Authentic artwork and reuse permission are still under review for this record. This unresolved entry blocks release.</p>'}${filmRecord.related.length ? `<h2 id="related-films">Discover Similar Films</h2><p class="notice">Connections by recorded filmmaker or release year.</p><div class="card-grid">${filmRecord.related.map((related) => card(related)).join('')}</div>` : ''}</article>`;
  } catch (error) {
    if (token === requestId) main.innerHTML = `<section class="cinema-section"><h1>Unable to open this dossier</h1><p class="error">${esc(error.message)}</p><a href="/discover">Return to the catalogue →</a></section>`;
  }
}

async function essay(id) {
  const essayRecord = editorial.essays.find((item) => item.id === id);
  if (!essayRecord) return notFound();
  title(essayRecord.title, `${essayRecord.title} — ${essayRecord.deck}`, { '@type': 'Article', articleSection: essayRecord.room });
  main.innerHTML = `<article class="reader"><a href="/journal" class="eyebrow">← Journal / ${esc(essayRecord.room)}</a><h1>${esc(essayRecord.title)}</h1><p class="deck">${esc(essayRecord.deck)}</p><figure class="reader-hero-visual">${subjectPhoto('essay/'+essayRecord.id,essayRecord.title)}<figcaption>Subject-specific image review</figcaption></figure><span class="eyebrow">${esc(essayRecord.period)} · ${esc(essayRecord.reading)} · ${essayRecord.editorial_status === 'RESEARCHED_DRAFT' ? 'researched feature · editorial draft' : essayRecord.editorial_status === 'SOURCE_CHECKED' ? 'research essay' : 'introductory essay'}</span>${notebookButton('reading',essayRecord.id,'+ Save to reading list','✓ In reading list')}${essayRecord.sections?.length ? `<nav class="reader-contents" aria-label="On this page"><span class="eyebrow">IN THIS FEATURE</span>${essayRecord.sections.map((section,i)=>`<a href="#part-${i+1}">${String(i+1).padStart(2,'0')} · ${esc(section.heading)}</a>`).join('')}</nav>${essayRecord.sections.map((section,i)=>`<section class="reader-section" id="part-${i+1}"><span class="eyebrow">PART ${String(i+1).padStart(2,'0')}</span><h2>${esc(section.heading)}</h2>${section.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}</section>`).join('')}` : essayRecord.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join('')}${essayRecord.question ? `<h2>A question to carry with you</h2><p>${esc(essayRecord.question)}</p>` : ''}<h2>Explore the connected films</h2><div id="connected-films" aria-live="polite"><p>Loading connected catalogue records…</p></div><h2>References</h2>${essayRecord.sources.map((source) => `<a class="source" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a>`).join('')}<p class="note">${essayRecord.editorial_status === 'RESEARCHED_DRAFT' ? 'New Lumetra research synthesis, 18 October 2026. Institutional sources are linked above. Historical claims are attributable; analysis is interpretive, not an assertion of firsthand film viewing. Specialist editorial review remains outstanding.' : essayRecord.editorial_status === 'SOURCE_CHECKED' ? 'Original AI-assisted research essay, based on the institutional sources above. Interpretation is identified as analysis; this is not a firsthand viewing review.' : 'Carried forward from the supplied Studio Preview. References need renewed editorial review; confidence is provisional.'} Reading time is calculated from the text.</p></article>`;
  const token = requestId;
  const ids = [...new Set(essayRecord.films || [])];
  const records = await Promise.all(ids.map(async (filmId) => {
    try { return { film: await api(`/api/films/${encodeURIComponent(filmId)}`) }; }
    catch { return { film: editorial.films.find((item) => item.id === filmId), unavailable: true }; }
  }));
  if (token !== requestId) return;
  const target = main.querySelector('#connected-films');
  if (target) target.innerHTML = `${records.some((record) => record.unavailable) ? '<p class="notice">Some live dossiers could not be loaded. Available catalogue metadata is shown; viewing details may be incomplete.</p>' : ''}<div class="card-grid connected-film-grid">${records.filter((record) => record.film).map((record) => card(record.film)).join('')}</div>${!records.length ? '<p>No connected films have been recorded.</p>' : ''}`;
}

function journal() {
  title('Journal', 'Researched features and editorial introductions on cinema history, craft, preservation, and film culture.');
  const usedFilms = new Set();
  const features = editorial.essays.filter(e => e.editorial_status === 'RESEARCHED_DRAFT');
  const introductions = editorial.essays.filter(e => e.editorial_status !== 'RESEARCHED_DRAFT');
  main.innerHTML = `<section class="page-head journal-head"><span class="eyebrow">LUMETRA / READING ROOM</span><h1 class="page-title">Go beyond the film.</h1><p>Films are more than titles and release years. Follow evidence, competing histories, artistic choices and the people who kept moving images alive.</p><div class="journal-counters"><span><b>${features.length}</b> long-form research features</span><span><b>${introductions.length}</b> shorter introductions awaiting expansion</span><span>Direct links to institutional sources</span></div></section><section class="cinema-section"><div class="section-heading"><div><span class="eyebrow">NEWLY EXPANDED / DOCUMENTED RESEARCH</span><h2>Features worth spending time with</h2></div></div><p class="editorial-disclaimer">Independent research syntheses with external citations. Not peer-reviewed scholarship or a substitute for specialist archives; interpretations are identified as analysis.</p><div class="essay-list essay-feature-list">${features.map(e => essayCard(e, usedFilms)).join('')}</div></section><section class="cinema-section editorial-library"><div class="section-heading"><div><span class="eyebrow">THE LIBRARY / NEXT IN RESEARCH</span><h2>Shorter readings</h2></div></div><p class="editorial-disclaimer">These inherited pieces are starting points. Their references need continued review and their subjects deserve expanded research.</p><div class="essay-list">${introductions.map(e => essayCard(e, usedFilms)).join('')}</div></section>`;
}

function world() {
  title('Cinema worlds', 'Travel through cinema history, world cinemas, movements and questions connected to the Lumetra catalogue.');
  const rooms = [...new Set(editorial.essays.map((essayRecord) => essayRecord.room))];
  const usedFilms = new Set();
  main.innerHTML = `<section class="page-head"><span class="eyebrow">Across time. Across borders.</span><h1 class="page-title">No single story contains cinema.</h1><p>Follow ${editorial.essays.filter(e=>e.editorial_status==='RESEARCHED_DRAFT').length} in-depth investigations and discover the people, technologies, places and films behind the history of cinema. Every researched feature links to its sources.</p></section><section class="cinema-section"><div class="destination-grid">${worldCards()}</div><div class="world-research-shelf"><span class="eyebrow">DEEP RESEARCH / START HERE</span><div class="essay-list essay-feature-list">${editorial.essays.filter(e=>e.editorial_status === 'RESEARCHED_DRAFT').map(e=>essayCard(e)).join('')}</div></div></section><section class="cinema-section"><div class="section-heading"><div><span class="eyebrow">A moving timeline</span><h2>The image learns to dream.</h2></div></div><div class="era-list">${timeline()}</div></section><section class="cinema-section learn-world-links"><div class="section-heading"><div><span class="eyebrow">BEHIND THE FRAMES</span><h2>The inventions and the people.</h2></div></div><div class="destination-grid"><a class="destination-card" href="/technology"><h3>Cinema technology</h3><p>Visit 17 rooms tracing cameras, film, lighting, sound, editing, projection, effects and new tools.</p><b>Explore the machines ↗</b></a><a class="destination-card" href="/crew"><h3>The crew</h3><p>Learn who works behind the camera and how to read the credits, across 20 departments.</p><b>Meet the people ↗</b></a></div></section>${rooms.map((room) => `<section class="cinema-section"><div class="section-heading"><h2>${esc(({ history: 'History & movements', culture: 'World cinemas', craft: 'The craft', preservation: 'Preservation', technology: 'Technology', industry: 'Studios, festivals & circulation' })[room] || room)}</h2></div><div class="essay-list">${editorial.essays.filter((essayRecord) => essayRecord.room === room && essayRecord.editorial_status !== 'RESEARCHED_DRAFT').map((item) => essayCard(item, usedFilms)).join('')}</div></section>`).join('')}`;
}

function museum() {
  title('The apparatus', 'Explore the material history of cinema: projection, cameras, film stock, editing and preservation.');
  const exhibits = [
    { n: '01', category: 'PROJECTION', title: 'The room of light', text: 'The Kinetoscope offered an individual moving-image experience through a viewing aperture. Projected cinema changed the machine, the room and the social scale of looking.', url: 'https://www.loc.gov/collections/edison-company-motion-pictures-and-sound-recordings/articles-and-essays/history-of-edison-motion-pictures/', image: 'stage.png' },
    { n: '02', category: 'CAMERA', title: 'The camera thinks', text: 'A camera does not simply record. Framing, movement and the visible presence of the operator turn a city into a point of view.', url: '/essay/montage-as-thought', image: 'man-with-a-movie-camera' },
    { n: '03', category: 'MATERIAL', title: 'The film strip', text: 'An archive holds physical materials as well as stories. Nitrate and acetate require different storage and conservation practices.', url: 'https://www.bfi.org.uk/bfi-national-archive/inside-archive', image: null },
    { n: '04', category: 'EDITING', title: 'The cut between images', text: 'Montage creates a third meaning in the space between shots. Editing is not only assembly; it is a way of thinking with time.', url: '/essay/montage-as-thought', image: null },
    { n: '05', category: 'VERSIONING', title: 'One work, many editions', text: 'A catalogue must separate a Work from its prints, restorations, scores, subtitles and playback sources. The object is never the same thing as one file.', url: '/essay/what-is-a-work', image: null },
    { n: '06', category: 'RESTORATION', title: 'The preservation master', text: 'Preservation separates the material kept safe from the copy used for access. Conservation and exhibition serve different purposes.', url: 'https://www.bfi.org.uk/features/history-archive', image: null },
  ];
  main.innerHTML = `<div class="museum-room"><section class="page-head"><span class="eyebrow">The apparatus / A digital cinema museum</span><h1 class="page-title">Before the story,<br><em>there was light.</em></h1><p>A film depends on a chain of inventions: exposing an image, advancing a strip, controlling light, recording sound and preserving what remains. Enter the collection by following the machine.</p></section><section class="museum-entry cinema-section"><div class="museum-entry-art">${subjectPhoto('museum/entry','Cinema apparatus and projection')}</div><div><span class="universe-kicker">COLLECTION 01 / THE MOTION MACHINE</span><h2>The apparatus is part of the story.</h2><p>Every screen has a material history. Every image arrives through a lens, a gate, a strip, a cut, a room and a decision about what should survive.</p><a class="cta ghost" href="/essay/the-screen-is-a-machine">Read the apparatus essay <span>↗</span></a></div></section><section class="cinema-section museum-collection"><div class="section-heading"><div><span class="eyebrow">The first collection / six stations</span><h2>Walk the chain<br><em>from light to memory.</em></h2></div><p>Each station connects an introduction to an institutional source or a Lumetra research essay. Unresolved technical histories are not presented as settled fact.</p></div><div class="museum-grid">${exhibits.map((object) => { const film = object.image && editorial.films.find((film) => film.id === `work-${object.image}`); return `<article class="museum-object" data-reveal>${film ? `<a href="${filmUrl(film.id)}">${poster(film)}</a>` : `<div class="exhibit-image">${subjectPhoto('museum/'+object.n,object.title)}</div>`}<span class="museum-category">${object.category}</span><h2>${object.title}</h2><p>${object.text}</p><a href="${object.url}"${object.url.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${object.url.startsWith('http') ? 'Institutional evidence' : 'Read the connected essay'} ↗</a></article>`; }).join('')}</div><p class="notice">The museum is an evidence-linked first collection, not a complete engineering catalogue. New equipment histories require source review before publication.</p></section></div>`;
}

async function person(name) {
  title(name, `Works carrying the director credit “${name}” in the Lumetra catalogue.`, { '@type': 'CollectionPage', about: { '@type': 'Thing', name } });
  main.innerHTML = `<section class="page-head"><span class="eyebrow">People / Recorded filmography</span><h1 class="page-title">${esc(name)}</h1><figure class="person-profile-visual">${subjectPhoto('person/'+name,name)}<figcaption>Portrait subject verification required</figcaption></figure><p>Works linked through the database’s recorded director credit. Biography and detailed crew roles require separate editorial research.</p></section><section class="cinema-section" id="person-films"><p>Loading recorded works…</p></section>`;
  const token = requestId;
  try {
    const result = await api(`/api/films?${new URLSearchParams({ director: name, limit: 48 })}`);
    if (token !== requestId) return;
    document.querySelector('#person-films').innerHTML = `<div class="card-grid">${result.items.filter((filmRecord) => filmRecord.director === name).map((filmRecord) => card(filmRecord)).join('')}</div><a class="cta ghost" href="/discover?q=${encodeURIComponent(name)}">Search the full catalogue →</a>`;
  } catch (error) {
    if (token === requestId) document.querySelector('#person-films').textContent = error.message;
  }
}

function about() {
  title('About & sources', 'Learn how Lumetra separates catalogue evidence, editorial interpretation, artwork provenance and official viewing pathways.');
  main.innerHTML = `<article class="reader"><span class="eyebrow">About Lumetra</span><h1>Everything Cinema.<br><em>Evidence first.</em></h1><p>Lumetra connects a film catalogue to cinema history, craft and official viewing pathways. Its archive includes sparse records alongside introductory editorial dossiers; the two should never be mistaken for equal research depth.</p><h2>What a viewing label means</h2><p>“Official external viewing” means an eligible source passes the inherited database publication gate. “Catalogue record” establishes discovery, not playback rights. Embedding needs separate permission and technical evidence. Checks expire after seven days.</p><h2>Images and attribution</h2><p>The logo, stage artwork and opening film were supplied by the owner and are preserved unchanged. Historical images are included only with a recorded source page, rights statement and attribution.</p>${statsData ? `<h2>Database snapshot</h2><p>${Number(statsData.works).toLocaleString()} works; ${Number(statsData.source_records).toLocaleString()} playback-source records; ${Number(statsData.eligible_sources).toLocaleString()} eligible source records; ${Number(statsData.watchable_works).toLocaleString()} distinct works with eligible sources.</p>` : ''}<h2>Institutional resources</h2><a class="source" href="https://www.bfi.org.uk/bfi-national-archive" target="_blank" rel="noopener noreferrer">BFI National Archive ↗</a><a class="source" href="https://www.loc.gov/apis/" target="_blank" rel="noopener noreferrer">Library of Congress APIs ↗</a><a class="source" href="https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia" target="_blank" rel="noopener noreferrer">Wikimedia Commons reuse guidance ↗</a></article>`;
}


async function myCinema() {
  title('My Cinema', 'Your private, browser-only film watchlist and research reading list.');
  const book = loadNotebook();
  const count = book.saved.length + book.watched.length + book.reading.length;
  main.innerHTML = `<section class="page-head notebook-head"><span class="eyebrow">THE PRIVATE SCREENING ROOM</span><h1 class="page-title">Make cinema<br><em>your own.</em></h1><p>A personal notebook for films to explore, works you have watched and essays to read. Data stays in this browser; no account, tracking or server sync.</p><div class="notebook-stats"><span><strong>${book.saved.length}</strong> saved films</span><span><strong>${book.watched.length}</strong> watched</span><span><strong>${book.reading.length}</strong> readings</span></div><div class="notebook-tools"><button type="button" class="cta" data-notebook-export ${count?'':'disabled'}>Export notebook ↓</button><label class="cta ghost notebook-import">Import notebook<input type="file" id="notebook-import" accept="application/json,.json" hidden></label></div><p class="notebook-status" id="notebook-status" role="status">Export a backup before clearing browser storage or changing devices.</p></section><section class="cinema-section notebook-shelf"><div class="section-heading"><div><span class="eyebrow">01 / YOUR WATCHLIST</span><h2>To discover</h2></div><a href="/discover" class="section-link">Browse the archive ↗</a></div><div id="notebook-saved"><p class="notice">${book.saved.length?'Loading your saved titles…':'No saved films yet. Open a film and choose Save.'}</p></div></section><section class="cinema-section notebook-shelf"><div class="section-heading"><div><span class="eyebrow">02 / VIEWING DIARY</span><h2>Already watched</h2></div></div><div id="notebook-watched"><p class="notice">${book.watched.length?'Loading recorded films…':'Mark films as watched from their dossier pages.'}</p></div></section><section class="cinema-section notebook-shelf"><div class="section-heading"><div><span class="eyebrow">03 / RESEARCH SHELF</span><h2>Reading list</h2></div><a href="/journal" class="section-link">Explore stories ↗</a></div><div id="notebook-reading">${book.reading.length?book.reading.map(id=>editorial.essays.find(e=>e.id===id)).filter(Boolean).map(e=>essayCard(e)).join(''):'<p class="notice">Save researched essays to build a reading list.</p>'}</div></section>`;
  const request = requestId;
  const ids=[...new Set([...book.saved,...book.watched])].slice(0,MAX_NOTEBOOK_ITEMS);
  const chunks=[];for(let i=0;i<ids.length;i+=40)chunks.push(ids.slice(i,i+40));
  const records=await Promise.all(chunks.map(async part=>{try{return (await api(`/api/lookup?ids=${encodeURIComponent(part.join(','))}`)).items;}catch{return [];}}));
  if(request!==requestId)return;
  const byId=new Map(records.flat().map(f=>[f.id,f]));
  for(const kind of ['saved','watched']){
    const target=document.getElementById('notebook-'+kind);
    if(!target||!book[kind].length)continue;
    const found=book[kind].map(id=>byId.get(id)).filter(Boolean);
    target.innerHTML = `<div class="card-grid">${found.map(f=>card(f)).join('')}</div>`+(found.length<book[kind].length?'<p class="notice">Some saved records are no longer accessible in this catalogue snapshot.</p>':'');
  }
}
const MAX_NOTEBOOK_ITEMS=250;

function notFound() { title('Page not found', 'This Lumetra room is not in the archive. Return to the cinema catalogue.'); main.innerHTML = '<section class="cinema-section"><h1>That room is not in the archive.</h1><a class="cta" href="/">Return Home →</a></section>'; }

async function render() {
  const renderRequest = ++requestId;
  const path = location.pathname;
  motionCleanup();
  closeMenu(false);
  document.body.classList.toggle('home-page', path === '/');
  syncHorizon(path);
  const headerKey = path === '/' ? 'home' :
    path === '/watch' ? 'watch' :
      path === '/discover' && new URL(location.href).searchParams.get('artwork') === '1' ? 'collections' :
        path === '/discover' || path.startsWith('/film/') || path.startsWith('/person/') || path === '/contemporary' ? 'discover' :
          path === '/world' ? 'world' :
            path === '/journal' || path.startsWith('/essay/') ? 'journal' :
              path === '/museum' ? 'museum' :
                path.startsWith('/technology') ? 'technology' :
                  path.startsWith('/crew') ? 'crew' : null;
  for (const link of document.querySelectorAll('#nav a')) {
    if (link.dataset.nav === headerKey) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (isLearningPath(path)) { renderLearning(main, path, title); return; }
  if (path === '/attributions') { attributions(); return; }
  if (path === '/corrections') { corrections(); return; }
  if (!editorial) {
    main.innerHTML = '<div class="loading" role="status">Opening the archive and loading the programme…</div>';
    try {
      editorial = await api('/api/editorial');
      const [staticArtwork, programming] = await Promise.all([
        fetch('/artwork.json').then((response) => response.ok ? response.json() : {}).catch(() => ({})),
        api(`/api/programming?seed=${encodeURIComponent(programmingSeed())}`).then(disjointProgramme).catch((error) => { programmeError = `Programme unavailable: ${error.message}. Use ↻ to retry; no substitute films have been added.`; return null; }),
      ]);
      programmingData = programming;
      const apiArtwork = Object.fromEntries((programming ? [...programming.carousel, ...programming.history, ...programming.featured, ...programming.watch, ...programming.collection] : []).filter((film) => Object.hasOwn(film, 'artwork')).map((film) => [film.id, film.artwork]));
      artwork = { ...staticArtwork, ...apiArtwork };
      statsData = await api('/api/stats').catch(() => null);
    } catch (error) {
      if (renderRequest === requestId) main.innerHTML = `<div class="error">${esc(error.message)}</div>`;
      return;
    }
  }
  if (renderRequest !== requestId) return;
  if (path === '/' && editorial) {
    // Same seed keeps the selection stable, but recheck expiring viewing evidence.
    main.innerHTML = '<div class="loading" role="status">Loading this session’s programme…</div>';
    try {
      programmingData = disjointProgramme(await api(`/api/programming?seed=${encodeURIComponent(programmingSeed())}`));
      programmeError = '';
    } catch (error) { programmeError = `Today’s programme is unavailable: ${error.message}. Use ↻ to retry.`; }
    if (renderRequest !== requestId) return;
  }
  if (path === '/') home();
  else if (path === '/discover' || path === '/watch') await discover(path === '/watch');
  else if (path.startsWith('/film/')) await film(decodeURIComponent(path.slice(6)));
  else if (path === '/contemporary') await discover(false);
  else if (path === '/journal') journal();
  else if (path === '/my-cinema') await myCinema();
  else if (path.startsWith('/essay/')) await essay(decodeURIComponent(path.slice(7)));
  else if (path === '/world') world();
  else if (path === '/museum') museum();
  else if (path.startsWith('/person/')) await person(decodeURIComponent(path.slice(8)));
  else if (path === '/about') about();
  else if (path === '/attributions') attributions();
  else if (path === '/corrections') corrections();
  else notFound();
}

function attributions() {
  title('Image credits and rights','Sources, creators, licences and changes for approved Lumetra subject photographs.');
  main.innerHTML=`<article class="reader"><span class="eyebrow">RIGHTS / PROVENANCE</span><h1>Every photograph has a source.</h1><p>This private review contains unfinished image research. The records below cover only the three photographs reviewed in the recovery checkpoint; they do not establish image completion across the catalogue. Original brand media is preserved from the supplied project.</p>${Object.entries(subjectImages).map(([key,image])=>`<section><h2>${esc(image.subject)}</h2>${subjectPhoto(key,image.subject)}<p><strong>Creator:</strong> ${esc(image.creator)}. <strong>Identity evidence:</strong> ${esc(image.evidence)}</p></section>`).join('')}<h2>Catalogue artwork</h2><p>Film-image records inherited from the project carry their own provenance on film dossier pages. Their current rights, subject match and loading checks remain in the release register and must be renewed before release.</p><h2>Corrections and rights enquiries</h2><p><a href="/corrections">Report an attribution, subject-identification or rights concern</a>. Include the relevant page and supporting evidence. Reports enter the private review queue.</p><h2>Your notebook</h2><p>My Cinema stores watchlist, watched and reading IDs in this browser. Export a backup before clearing browser storage. The application does not send notebook contents to its server.</p></article>`;
}

function navigate(path) {
  history.pushState({}, '', path);
  const reduced = document.documentElement.classList.contains('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && typeof document.startViewTransition === 'function') {
    // Progressive enhancement; the asynchronous render is part of the transition.
    document.startViewTransition(() => render()).finished.catch(() => {});
  } else render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

document.addEventListener('click', async (event) => {
  const notebookControl = event.target.closest('[data-notebook-kind]');
  if (notebookControl) {
    event.preventDefault();
    const kind = notebookControl.dataset.notebookKind, id=notebookControl.dataset.notebookId;
    const next=toggleNotebook(loadNotebook(),kind,id);
    if (!writeNotebook(next)) {
      notebookControl.textContent = 'Browser storage unavailable';
      return;
    }
    const active=next[kind].includes(id);
    document.querySelectorAll('[data-notebook-kind]').forEach(button=>{
      if(button.dataset.notebookKind!==kind || button.dataset.notebookId!==id)return;
      button.classList.toggle('is-saved',active);
      button.setAttribute('aria-pressed',String(active));
      button.textContent = active ? button.dataset.labelActive : button.dataset.labelAdd;
    });
    if(location.pathname==='/my-cinema') await myCinema();
    return;
  }
  if(event.target.closest('[data-notebook-export]')){
    const blob=new Blob([notebookJSON(loadNotebook())],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='lumetra-my-cinema.json';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return;
  }
  const reshuffle = event.target.closest('[data-reshuffle]');
  if (reshuffle) {
    if (programmeBusy) return;
    programmeBusy = true;
    reshuffle.disabled = true;
    const token = requestId;
    const status = main.querySelector('[data-programme-status]');
    if (status) status.textContent = 'Loading a new programme…';
    try {
      const next = disjointProgramme(await api(`/api/programming?seed=${encodeURIComponent(programmingSeed(true))}`));
      programmingData = next; programmeError = '';
      for (const film of [...next.carousel, ...next.history, ...next.featured, ...next.watch, ...next.collection]) if (Object.hasOwn(film, 'artwork')) artwork[film.id] = film.artwork;
      if (token === requestId && location.pathname === '/') { home(); main.querySelector('[data-reshuffle]')?.focus({ preventScroll: true }); }
    } catch (error) {
      programmeError = `Programme unavailable: ${error.message}. ${programmingData ? 'The previous selection is still shown.' : 'No substitute films have been added.'} Use ↻ to retry.`;
      if (token === requestId && status) status.textContent = programmeError;
    } finally { programmeBusy = false; reshuffle.disabled = false; }
    return;
  }
  const link = event.target.closest('a');
  if (link && link.origin === location.origin && !link.hash && !link.target && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(link.pathname + link.search); }
  const galleryButton = event.target.closest('[data-gallery]');
  if (galleryButton) document.querySelector('#gallery')?.scrollBy({ left: Number(galleryButton.dataset.gallery) * 280, behavior: document.documentElement.classList.contains('reduced') ? 'auto' : 'smooth' });
});

document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-learning-image')) {
    event.target.hidden = true;
    const alternative = event.target.parentElement?.querySelector('.learn-photo-fallback');
    if (alternative) alternative.hidden = false;
    return;
  }
  if (event.target instanceof HTMLImageElement && event.target.hasAttribute('data-film-artwork')) {
    const parent = event.target.closest('.poster');
    if (!parent) return;
    parent.classList.remove('has-artwork'); parent.classList.add('no-image');
    event.target.remove();
    const label = parent.querySelector('.artwork-kind');
    if (label) label.textContent = 'Image unavailable · original metadata title treatment';
  }
}, true);

document.addEventListener('change', async event=>{
  if(event.target.id!=='notebook-import')return;
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>150000)throw Error('Notebook import exceeds 150 KB');
    const entries=importNotebook(await file.text());
    if(!writeNotebook(entries))throw Error('Browser storage unavailable');
    if(location.pathname==='/my-cinema')await myCinema();
    const status=document.querySelector('#notebook-status');
    if(status)status.textContent='Notebook imported locally. No data was uploaded.';
  }catch(error){const status=document.querySelector('#notebook-status');if(status)status.textContent=error.message;}
});
window.addEventListener('popstate', render);
const menuPanel = document.querySelector('#menu-panel');
const menuSheet = menuPanel?.querySelector('.menu-sheet');
let menuFocus;
function syncHorizon(path = location.pathname) {
  const active = path === '/' ? 'home' : path.startsWith('/film/') || path === '/discover' || path === '/watch' || path.startsWith('/person/') ? 'films' : path === '/world' ? 'worlds' : path === '/journal' || path.startsWith('/essay/') ? 'stories' : null;
  for (const link of document.querySelectorAll('[data-horizon-link]')) {
    const current = link.dataset.horizonLink === active;
    link.classList.toggle('is-active', current);
    if (current && link.tagName === 'A') link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
function closeMenu(restoreFocus = true) {
  if (!menuPanel || menuPanel.hidden) return;
  menuPanel.hidden = true;
  menuPanel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('menu-open');
  for (const node of document.querySelectorAll('#main,.site-footer,.header,.horizon-nav')) node.inert = false;
  for (const button of document.querySelectorAll('#menu,#horizon-menu')) { button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'Open menu'); }
  syncHorizon();
  if (restoreFocus && menuFocus?.isConnected) menuFocus.focus({ preventScroll: true });
}
function openMenu() {
  if (!menuPanel || document.body.classList.contains('intro-active')) return;
  menuFocus = document.activeElement;
  menuPanel.hidden = false;
  menuPanel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('menu-open');
  for (const node of document.querySelectorAll('#main,.site-footer,.header,.horizon-nav')) node.inert = true;
  for (const button of document.querySelectorAll('#menu,#horizon-menu')) { button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-label', 'Close menu'); }
  document.querySelector('#menu-close')?.focus({ preventScroll: true });
}
for (const button of document.querySelectorAll('#menu,#horizon-menu')) button.onclick = () => menuPanel.hidden ? openMenu() : closeMenu();
document.querySelector('#menu-close')?.addEventListener('click', () => closeMenu());
document.querySelector('#menu-backdrop')?.addEventListener('click', () => closeMenu());
menuPanel?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
  if (event.key === 'Tab') {
    const nodes = [...menuSheet.querySelectorAll('a,button')];
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

const motion = document.querySelector('#motion');
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
try { reduced = localStorage.getItem('lumetra-motion') === 'reduced' || reduced; } catch {}
function setMotion() { document.documentElement.classList.toggle('reduced', reduced); for (const button of document.querySelectorAll('#motion,#menu-motion')) { button.textContent = reduced ? 'Enable motion' : 'Reduce motion'; button.setAttribute('aria-pressed', String(reduced)); } }
motion.onclick = () => { reduced = !reduced; try { localStorage.setItem('lumetra-motion', reduced ? 'reduced' : 'normal'); } catch {} setMotion(); };
document.querySelector('#menu-motion')?.addEventListener('click', () => motion.click());
setMotion();
render();

function corrections() {
  title('Corrections', 'Submit evidence for a catalogue, viewing-source or image-rights correction to the Lumetra archive.');
  main.innerHTML = `<article class="reader"><span class="eyebrow">Help improve the archive</span><h1>A better record starts with evidence.</h1><p>Flag a metadata error, a broken viewing source or an image-rights concern. Submissions enter a private moderation queue and never publish automatically. Please do not include sensitive personal information.</p><form id="correction" class="correction-form"><label>Film or page URL<input name="page" type="url" required maxlength="500" placeholder="https://…"></label><label>What needs correcting?<textarea name="message" rows="6" required minlength="20" maxlength="4000"></textarea></label><label>Supporting source URL<input name="evidence" type="url" required maxlength="500"></label><label class="sr-only">Leave blank<input name="website" tabindex="-1" autocomplete="off"></label><button class="cta" type="submit">Submit for review ↗</button><p id="correction-status" role="status"></p></form></article>`;
  document.querySelector('#correction').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch('/api/corrections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Submission unavailable');
      document.querySelector('#correction-status').textContent = `Received for moderation. Reference: ${data.id}`;
      form.reset();
    } catch (error) { document.querySelector('#correction-status').textContent = error.message; } finally { button.disabled = false; }
  };
}

// A source record may be verified yet its image CDN fail at runtime.
// A broken image must never leave an empty rectangle.
document.addEventListener('error', (event) => {
  if (!(event.target instanceof HTMLImageElement) || !event.target.matches('img[data-film-artwork]')) return;
  const card = event.target.closest('.poster');
  if (card) { card.classList.add('broken-artwork'); card.classList.remove('has-artwork'); card.classList.add('no-image'); }
}, true);
