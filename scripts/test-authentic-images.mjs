import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {approvedSubjectImage, subjectPhoto, subjectImages} from '../public/subject-images.js';
import {posterMarkup,fallbackFilmImage} from '../public/artwork-ui.js';
test('16 mm example retains exact subject, photograph source and attribution',()=>{
 const image=approvedSubjectImage('technology/film/16-mm-film');
 assert.ok(image);assert.match(image.subject,/16 mm/);assert.ok(existsSync('public'+image.url));
 const markup=subjectPhoto('technology/film/16-mm-film','16 mm film');
 assert.match(markup,/Runner1616/);assert.match(markup,/CC BY-SA 3.0/);assert.match(markup,/film-base chemistry/);
});
test('unresolved identities never receive a random illustration or another subject photograph',()=>{
 for(const key of ['technology/film/nitrate-film-base','technology/lenses/zoom-lenses','person/Unknown']) {
  assert.equal(approvedSubjectImage(key),null);const html=subjectPhoto(key,key);
  assert.doesNotMatch(html,/<img|\.svg/);assert.match(html,/data-image-status="PENDING"/);
 }
 assert.equal(fallbackFilmImage({id:'unknown'}),'');
 assert.doesNotMatch(posterMarkup({id:'unknown',title:'Unknown'}),/<img|\/visuals\//);
});
test('rights, identity evidence and health must all pass',()=>{
 const good=subjectImages['technology/film/16-mm-film'];
 for(const change of [{review_status:'PENDING'},{health_status:'BROKEN'},{license:''},{evidence:''},{source_page:'http://bad'},{url:'/visuals/fake.svg'}])
  assert.equal(approvedSubjectImage('test',{test:{...good,...change}}),null);
});
test('rejected V5 art cannot be selected by frontend modules',()=>{
 for(const name of ['app.js','artwork-ui.js','cinema-learning.js'])assert.doesNotMatch(readFileSync('public/'+name,'utf8'),/\/visuals\//);
 assert.equal(existsSync('public/visuals'),false);
});
