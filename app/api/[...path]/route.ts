import {env} from 'cloudflare:workers';
import {api} from '../../../site-server/handler.js';
export async function GET(request:Request){return api(request,env);}
export async function POST(request:Request){return api(request,env);}
