import http from 'node:http';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
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
const runFile=promisify(execFile);
async function openLabPage(url){
  // URL is built only from our bound loopback port; no shell interpolation.
  const file=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  await runFile(file,args,{windowsHide:true,timeout:10000});
}
function portNumber(value){
  const text=String(value).trim();
  if(!/^\d+$/.test(text)||!Number.isInteger(Number(text))||Number(text)<0||Number(text)>65535)throw Error('PORT must be an integer from 0 to 65535.');
  return Number(text);
}
function listen(port){
  const server=createServer();
  return new Promise((resolve,reject)=>{
    const failed=error=>{server.removeListener('listening',ready);reject(error);};
    const ready=()=>{server.removeListener('error',failed);resolve(server);};
    server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1');
  });
}
export async function startServer({port=process.env.PORT||4177,announce=console.log,openPage=null}={}){
  const requested=portNumber(port);
  // Check the entry point before advertising a URL.
  await stat(path.join(root,'lab.html'));
  let server;
  try{server=await listen(requested);}
  catch(error){
    if(!['EADDRINUSE','EACCES'].includes(error.code)||requested===0)throw error;
    announce('Port '+requested+' is unavailable ('+error.code+'); selecting a free local port.');
    server=await listen(0);
  }
  const actual=server.address().port,base='http://127.0.0.1:'+actual,url=base+'/lab.html';
  announce('Full CNS laboratory: '+url);
  announce('Tactical sandbox: '+base+'/');
  announce('Keep this window open. Press Ctrl+C to stop the server.');
  if(openPage){
    try{await openPage(url);}
    catch(error){announce('Could not open the browser automatically: '+error.message+'\nOpen this address manually: '+url);}
  }
  return {server,port:actual,url};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  startServer({openPage:process.argv.includes('--open-lab')?openLabPage:null}).catch(error=>{
    console.error('Laboratory startup failed: '+error.message);process.exitCode=1;
  });
}
