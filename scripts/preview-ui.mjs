import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('public');
const origin='https://dcv-research-platform.junewoopark16.workers.dev';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/api/')){
      if(req.method!=='GET'){res.writeHead(405);res.end('Read-only verification proxy');return;}
      const r=await fetch(origin+req.url);res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});res.end(Buffer.from(await r.arrayBuffer()));return;
    }
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const body=fs.readFileSync(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
  }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(8788,'127.0.0.1',()=>console.log('Read-only preview: http://127.0.0.1:8788'));

