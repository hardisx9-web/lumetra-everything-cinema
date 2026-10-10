// Native Termux preview of the real Worker API using a D1-compatible SQLite
// adapter. Not a production deployment or a substitute for workerd/browser QA.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {openCatalogue,importCatalogue} from './local-catalogue.mjs';
import {api} from '../site-server/handler.js';
const port=Number(process.env.PORT||4173),root=resolve('public');
const {sqlite,db,assets}=openCatalogue(process.env.LOCAL_CATALOGUE_DB||'.sites-runtime/artwork-preview.sqlite');
await importCatalogue(db,assets);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4'};
const csp="default-src 'self'; img-src 'self' https:; media-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:'+port);let result;
 if(url.pathname.startsWith('/api/')){
  let length=0;const parts=[];for await(const chunk of req){length+=chunk.length;if(length>12000){res.writeHead(413);res.end();return;}parts.push(chunk);}
  const body=Buffer.concat(parts);result=await api(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})}),{DB:db,ASSETS:assets});
 }else if(url.pathname.startsWith('/publication/'))result=new Response('Not found',{status:404});
 else{
  const path=decodeURIComponent(url.pathname),file=resolve(root,'.'+(path.includes('.')?path:'/shell.html'));
  if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
  try{const info=await stat(file);if(!info.isFile())throw Error('not file');const bytes=await readFile(file);const headers={'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(file.endsWith('.html')?{'Content-Security-Policy':csp}:{})};
   const range=req.headers.range;if(range&&file.endsWith('.mp4')){const m=/^bytes=(\d+)-(\d*)$/.exec(range),start=Number(m?.[1]),end=m?.[2]?Math.min(Number(m[2]),bytes.length-1):bytes.length-1;if(!m||start>end)result=new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.length}});else result=new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Accept-Ranges':'bytes'}});}else result=new Response(bytes,{headers});
  }catch{result=new Response('Not found',{status:404});}
 }
 res.writeHead(result.status,Object.fromEntries(result.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await result.arrayBuffer()));
 }catch(e){console.error(e.message);res.writeHead(500);res.end('Preview request failed');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Lumetra local preview: http://127.0.0.1:${port}/ (persistent local SQLite; no deployment)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{sqlite.close();process.exit(0);}));
