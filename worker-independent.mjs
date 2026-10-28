import {api} from './site-server/handler.js';
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/')) return api(request,env);
 if(url.pathname.startsWith('/publication/')) return new Response('Not found',{status:404});
 if(!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
 if(!url.pathname.split('/').pop().includes('.')) url.pathname='/shell.html';
 const response=await env.ASSETS.fetch(new Request(url,request));
 const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');
 return new Response(response.body,{status:response.status,headers});
}};
