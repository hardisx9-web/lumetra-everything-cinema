import {initIntro} from './intro.js';
import {startLumetraMotion} from './motion-layer.js';
try {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || localStorage.getItem('lumetra-motion') === 'reduced') {
    document.documentElement.classList.add('reduced');
  }
} catch {
  // Motion preference storage is optional; the media query still applies in CSS.
}
initIntro();
startLumetraMotion();
// Resume the immutable publication import only when the hosted catalogue is empty or not indexed.
// Never replace an API failure with invented film results.
async function catalogueReady() {
  const response = await fetch('/api/stats');
  if (!response.ok) return false;
  const state = await response.json();
  return state.ready === true && state.artwork_ready === true && Number(state.works) > 0;
}
// Educational wings are static and should stay readable even if the film database is offline.
const learningPath = /^\/(?:technology|crew)(?:\/|$)/.test(location.pathname);
if (learningPath) {
  await import('./app.js');
} else {
try {
  let ready = await catalogueReady().catch(() => false);
  if (!ready) {
    for (let n = 0; n < 300 && !ready; n += 1) {
      const response = await fetch('/api/initialize', { method: 'POST' });
      if (!response.ok) throw Error('Catalogue preparation failed. Please refresh to resume.');
      const state = await response.json();
      document.querySelector('#main').textContent = state.ready ? 'Opening the archive…' : `Opening the archive · ${state.progress}%`;
      ready = state.ready && await catalogueReady().catch(() => false);
    }
  }
  if (!ready) throw Error('Catalogue preparation did not produce an indexed film catalogue. Please refresh to resume.');
  await import('./app.js');
} catch (error) {
  document.querySelector('#main').textContent = error.message;
}
}
