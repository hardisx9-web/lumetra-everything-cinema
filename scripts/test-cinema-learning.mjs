import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {learningData as d} from '../public/learning-data.js';
import {isLearningPath,renderLearning} from '../public/cinema-learning.js';

const allTech=d.technology.flatMap(g=>g.items);
const allCrew=d.crew.flatMap(g=>g.items);
const assertUnique=(list,label)=>{const key=new Set;for(const item of list){const id=label(item);assert(!key.has(id),`Duplicate route identity ${id}`);key.add(id);}};
assert.equal(d.technology.length,17);
assert.equal(d.crew.length,20);
assert(allTech.length>=240);
assert(allCrew.length>=300);
assert(d.cameraTimeline.length>=19);
assert(d.cameraTimeline.filter(x=>x.photo).length>=6);
assertUnique(d.technology,g=>g.id);
assertUnique(d.crew,g=>g.id);
assertUnique(d.technology.flatMap(g=>g.items.map(i=>({group:g.id,item:i}))), x=>`/technology/${x.group}/${x.item.slug}`);
assertUnique(d.crew.flatMap(g=>g.items.map(i=>({group:g.id,item:i}))),x=>`/crew/${x.group}/${x.item.slug}`);
for(const group of [...d.technology,...d.crew]){
 assert(group.title.length>=4&&group.subtitle.length>25&&group.context.length>200,`Thin introduction ${group.title}`);
 for(const item of group.items){assert(item.brief.length>=25,`Thin role/device description ${item.name}`);assert(item.slug.length>0);}
}
for(const cam of d.cameraTimeline){assert(d.sources[cam.source],`Camera source missing ${cam.name}`); assert(cam.description.length>90,`Thin camera essay ${cam.name}`);if(cam.photo){assert(cam.photo.page.startsWith('https://commons.wikimedia.org/'));assert(cam.photo.credit.length>25);}}
for(const [name,s] of Object.entries(d.sources)){assert(s.url.startsWith('https://'),`Not HTTPS: ${name}`);}
const documented=allCrew.filter(i=>i.profile);
assert(documented.length>=25);
for(const item of documented) {assert(item.profile.does.length>75);assert(item.profile.example.length>55);assert(d.sources[item.profile.source]);}
assert(isLearningPath('/technology/cameras'));
assert(isLearningPath('/crew/camera'));
assert(!isLearningPath('/film/work-a'));
const server={innerHTML:'',querySelector:()=>null};
const title=(...a)=>{assert(a[0].length>3);};
const smoke=(path,needle)=>{renderLearning(server,path,title);assert(server.innerHTML.includes(needle),`route ${path} doesn't show ${needle}`);assert(!server.innerHTML.includes('Entry not found.'));};
smoke('/technology','The machines behind');
smoke('/technology/cameras','From 1890s to today.');
smoke('/technology/lenses','Lenses &amp; image formation');
smoke('/technology/cameras/arri-alexa','ARRI ALEXA');
smoke('/crew','Read the credits.');
smoke('/crew/camera','focus puller');
smoke('/crew/camera/first-assistant-camera-1st-ac-focus-puller','What does this person actually do?');
smoke('/crew/choreography/stunt-double-dupe','Dupe');
for(const g of d.crew){smoke('/crew/'+g.id,g.title.replaceAll('&','&amp;'));}
for(const g of d.technology){if(g.id!=='cameras')smoke('/technology/'+g.id,g.title.replaceAll('&','&amp;'));}
const shell=readFileSync('public/shell.html','utf8'),index=readFileSync('public/index.html','utf8');
assert.equal(index,shell);
for(const s of ['href="/crew"','href="/technology"','/learning.css'])assert(shell.includes(s));
assert(shell.includes('href="/discover?artwork=1"'),'Collections must remain reachable');
const app=readFileSync('public/app.js','utf8');
assert(app.includes('isLearningPath(path)'));
assert(app.includes('data-learning-image'));
assert(app.includes('THE MACHINES'));
console.log(`Learning curriculum verified: ${d.technology.length} tech disciplines, ${allTech.length} reference items, ${d.crew.length} crew departments, ${allCrew.length} role/variant entries, ${documented.length} researched crew profiles, ${d.cameraTimeline.length} camera milestones and ${d.cameraTimeline.filter(c=>c.photo).length} archival camera images.`);
