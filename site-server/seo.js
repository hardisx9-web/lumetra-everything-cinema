import {learningData} from '../public/learning-data.js';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles={'/':'Lumetra — Everything Cinema','/discover':'Discover films','/watch':'Verified viewing availability','/world':'World cinema and history','/journal':'Cinema stories','/crew':'Film crew directory','/technology':'Cinema technology','/technology/cameras':'Camera history','/museum':'Cinema museum','/my-cinema':'My Cinema','/about':'About Lumetra','/attributions':'Image credits and rights','/corrections':'Corrections and rights enquiries'};
export async function shellMetadata(request,shell,db){
 const url=new URL(request.url),path=url.pathname;
 let title=titles[path],description='Explore cinema, its people, technologies and history. Viewing and image rights are verified separately.';
 if(path.startsWith('/film/')&&db){
  const id=decodeURIComponent(path.slice(6));
  if(/^[\w-]{1,160}$/.test(id))try{const row=await db.prepare('SELECT title,year,director FROM work WHERE id=?').bind(id).first();if(row){title=row.title+(row.year?' ('+row.year+')':'');description=[row.title,row.year,row.director].filter(Boolean).join(' · ')+'. Film catalogue record, evidence and viewing availability.';}}catch{/* Initial import can be incomplete; do not invent metadata. */}
 }
 for(const kind of ['technology','crew'])if(path.startsWith('/'+kind+'/')){
  const [,groupId,slug]=path.slice(1).split('/');const group=learningData[kind].find(g=>g.id===groupId),item=group?.items.find(i=>i.slug===slug);
  if(item){title=item.name;description=item.brief;}else if(group&&!slug){title=group.title;description=group.subtitle;}
 }
 if(path.startsWith('/person/')){title=decodeURIComponent(path.slice(8))+' — recorded director credit';description='Catalogue works carrying this director-credit string. Individual identity and biography remain subject to evidence review.';}
 if(!title)title='Lumetra — Everything Cinema';
 const canonical=url.origin+path;
 let html=await shell.text();
 html=html.replace(/<title>.*?<\/title>/s,`<title>${escape(title)}${path==='/'?'':' — Lumetra'}</title>`)
  .replace(/(<meta name="description" content=")[^"]*(")/,`$1${escape(description)}$2`)
  .replace(/(<meta property="og:title" content=")[^"]*(")/,`$1${escape(title)}$2`)
  .replace(/(<meta property="og:description" content=")[^"]*(")/,`$1${escape(description)}$2`)
  .replace(/(<meta property="og:url" content=")[^"]*(")/,`$1${escape(canonical)}$2`)
  .replace(/(<link rel="canonical" href=")[^"]*(")/,`$1${escape(canonical)}$2`);
 // Notebook contents and search variants are private/browser state or duplicate
 // query views; preserve their pages but keep them out of the search index.
 if(path==='/my-cinema'||url.search)html=html.replace('</head>','<meta name="robots" content="noindex,follow"></head>');
 return html;
}
export function securityHeaders(headers=new Headers()){
 headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
 return headers;
}
