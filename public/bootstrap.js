import {initIntro} from './intro.js';
initIntro();
// Resume the immutable publication import only when the hosted catalogue is empty.
// Never replace an API failure with invented film results.
try{const check=await fetch('/api/stats');if(!check.ok){for(let n=0;n<100;n++){const r=await fetch('/api/initialize',{method:'POST'});if(!r.ok)throw Error('Catalogue preparation failed. Please refresh to resume.');const state=await r.json();if(state.ready)break;document.querySelector('#main').textContent='Opening the archive · '+state.progress+'%';}}await import('./app.js');}catch(e){document.querySelector('#main').textContent=e.message;}
