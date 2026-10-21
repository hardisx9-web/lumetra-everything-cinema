import {asset} from '../site-server/assets.js';
import {api} from '../site-server/handler.js';
import {shellMetadata,securityHeaders} from '../site-server/seo.js';
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    if(url.pathname.startsWith('/publication/'))return new Response('Not found',{status:404});
    if(url.pathname.startsWith('/api/'))return api(request,env);
    if(!url.pathname.includes('.') && !url.pathname.startsWith('/__')) {
      let shell = await env.ASSETS.fetch(new Request(new URL('/shell.html',url),request));
      if(shell.status>=300 && shell.status<400 && shell.headers.get('location')) shell=await env.ASSETS.fetch(new Request(new URL(shell.headers.get('location')!,url),request));
      const headers=new Headers(shell.headers);headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; media-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");headers.set('X-Content-Type-Options','nosniff');
      securityHeaders(headers);
      return new Response(await shellMetadata(request,shell,env.DB),{status:shell.status,headers});
    }
    if(url.pathname.includes('.'))return asset(request,env.ASSETS);
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
