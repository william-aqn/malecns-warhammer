import http from 'node:http';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const project=path.dirname(fileURLToPath(import.meta.url)),root=path.join(project,'dist'),full=path.join(project,'.cache','full-cns');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.bin':'application/octet-stream'};
const fullFiles=new Set(['manifest.json','graph.bin','neurons.json','retina.json']);
export function createServer(){return http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;}
    const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(name.includes('\\')||name.includes('\u0000')){res.writeHead(403).end();return;}
    let file,encoding;
    if(name.startsWith('/full-cns/')){
      const basename=name.slice('/full-cns/'.length);if(!fullFiles.has(basename)){res.writeHead(404).end('Not found');return;}
      file=path.join(full,basename);
      if(basename!=='manifest.json'&&/(?:^|[,\s])gzip(?:[,\s;]|$)/.test(req.headers['accept-encoding']||'')){
        try{await stat(file+'.gz');file+='.gz';encoding='gzip';}catch{}
      }
    }else{
      file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    }
    const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}
    const extension=path.extname(encoding?file.slice(0,-3):file);
    res.writeHead(200,{'Content-Type':types[extension]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(encoding?{'Content-Encoding':encoding,'Vary':'Accept-Encoding'}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){if(!res.headersSent)res.writeHead(error instanceof URIError?400:404);res.end('Not found');}
});}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const server=createServer();server.listen(Number(process.env.PORT||4177),'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port+' / full CNS: /lab.html'));
}
