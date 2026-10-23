// Reproducible extraction of an anatomical MaleCNS v1.0 escape subgraph.
// Data: CC BY 4.0. See data/MALECNS-ATTRIBUTION.md. No model is trained here.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=path.join(root,'.cache','malecns-upstream');
export const REVISION='d36ff5e192da832c4348ab509d150357cb70ddd8';
export const SOURCE='https://huggingface.co/slvDev/esp32-ai-fly';
export const ASSETS={
  'connectome.fcl':{bytes:14174411,sha256:'1e35e6ba658986de5e3163ea49b600378a2e3daa64700b8b619c4f21cc0a6e1f'},
  'escape-circuit.json':{bytes:38724,sha256:'566df28669c4b6ae5fff4a2330558837bce0c2a4fb08eb9edec4193285f3a91d'},
  'neurons.csv':{bytes:2132569,sha256:'348e54b2a1c94b8387263c7af82ff41e8518be5fd662aed62bc28ebf281c3703'}
};
export const sha256=b=>createHash('sha256').update(b).digest('hex');
function check(condition,message){if(!condition)throw new Error(message);}
async function asset(name,download){
  const expected=ASSETS[name],filename=path.join(cache,name);
  let b;try{b=await readFile(filename);}catch(e){
    if(e.code!=='ENOENT'||!download)throw e;
    const response=await fetch(SOURCE+'/resolve/'+REVISION+'/'+name,{signal:AbortSignal.timeout(60000)});
    check(response.ok,'Download failed: '+name+' HTTP '+response.status);
    b=Buffer.from(await response.arrayBuffer());
    check(b.length===expected.bytes&&sha256(b)===expected.sha256,'Source identity mismatch: '+name);
    await writeFile(filename,b);
  }
  check(b.length===expected.bytes&&sha256(b)===expected.sha256,'Source identity mismatch: '+name);
  return b;
}
// FCL1 contains independent raw LZ4 blocks. Decode with bounds checks.
export function decodeLz4(src,size){
  check(size>0&&size<=200000,'Invalid decoded size');
  const dst=new Uint8Array(size);let p=0,q=0;
  const byte=()=>{check(p<src.length,'Truncated LZ4');return src[p++];};
  const length=n=>{if(n!==15)return n;let x;do{x=byte();n+=x;}while(x===255);return n;};
  while(p<src.length){
    const token=byte(),literals=length(token>>>4);
    check(p+literals<=src.length&&q+literals<=size,'Invalid LZ4 literals');
    dst.set(src.subarray(p,p+literals),q);p+=literals;q+=literals;
    if(p===src.length)break;
    const offset=byte()|(byte()<<8),match=length(token&15)+4;
    check(offset>0&&offset<=q&&q+match<=size,'Invalid LZ4 match');
    for(let k=0;k<match;k++){dst[q]=dst[q-offset];q++;}
  }
  check(q===size,'LZ4 size mismatch');return dst;
}
export function extract(graph,circuit,csv){
  check(graph.toString('ascii',0,4)==='FCL1'&&graph.readUInt32LE(4)===1,'Unsupported graph');
  const N=graph.readUInt32LE(8),E=graph.readUInt32LE(12),blockRows=graph.readUInt32LE(16);
  check(N===48311&&E===9462135&&blockRows===32,'Unexpected graph shape');
  check(sha256(graph.subarray(20,20+4*N))===circuit.order_sha256,'Order mismatch');
  check(circuit.graph_sha256===ASSETS['connectome.fcl'].sha256,'Circuit graph mismatch');
  const rows=csv.trim().split(/\r?\n/),headers=rows.shift().split(',');
  const table=rows.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[headers[i],v])));
  const selected=[];
  for(const kind of ['inputs','outputs'])for(const side of ['L','R'])for(const n of circuit[kind][side]){
    const row=table[n.index];
    check(row&&Number(row.body_id)===n.body_id&&row.type===n.type&&row.side===side,'Annotation mismatch for '+n.body_id);
    selected.push({sourceIndex:n.index,bodyId:n.body_id,type:n.type,side,kind:kind==='inputs'?'input':'output',incomingTotal:0});
  }
  selected.sort((a,b)=>a.sourceIndex-b.sourceIndex);
  const local=new Map(selected.map((n,i)=>[n.sourceIndex,i]));
  check(selected.length===319&&local.size===319,'Unexpected selection');
  const edges=[];let offset=20+4*N,destination=0,totalEdges=0,totalContacts=0;
  while(destination<N){
    check(offset+16<=graph.length,'Truncated block');
    const count=graph.readUInt32LE(offset),ec=graph.readUInt32LE(offset+4),raw=graph.readUInt32LE(offset+8),packed=graph.readUInt32LE(offset+12);offset+=16;
    check(count===Math.min(blockRows,N-destination)&&offset+packed<=graph.length,'Invalid block');
    const b=decodeLz4(graph.subarray(offset,offset+packed),raw);offset+=packed;let cursor=0;
    const varint=()=>{let value=0;for(let i=0;i<5;i++){check(cursor<b.length,'Truncated varint');const v=b[cursor++];value+=(v&127)*2**(7*i);if(!(v&128))return value;}throw new Error('Invalid varint');};
    const degrees=Array.from({length:count},varint);
    check(degrees.reduce((a,x)=>a+x,0)===ec,'Degree mismatch');
    const from=new Uint32Array(ec);let k=0;
    for(const degree of degrees){let previous=0;for(let j=0;j<degree;j++){const delta=varint();check(j===0||delta>0,'Unsorted sources');previous+=delta;check(previous<N,'Invalid source');from[k++]=previous;}}
    k=0;
    for(let row=0;row<count;row++){
      const to=local.get(destination+row);let rowTotal=0;
      for(let j=0;j<degrees[row];j++){
        const contacts=varint(),source=local.get(from[k++]);check(contacts>0&&contacts<=32767,'Invalid weight');rowTotal+=contacts;
        if(to!==undefined&&source!==undefined)edges.push([source,to,contacts]);
      }
      totalContacts+=rowTotal;if(to!==undefined)selected[to].incomingTotal=rowTotal;
    }
    check(cursor===raw,'Unconsumed block data');totalEdges+=ec;destination+=count;
  }
  check(offset===graph.length&&totalEdges===E&&totalContacts===49481754,'Decoded graph totals mismatch');
  return {
    schema:1,id:'malecns-v1-escape-319',dataset:'male-cns:v1.0',license:'CC-BY-4.0',
    source:{url:SOURCE,revision:REVISION,assets:ASSETS,datasetUrl:'https://male-cns.janelia.org/',sourceNodes:N,sourceEdges:E,sourceContacts:totalContacts},
    selection:'Induced subgraph of all LC4/LPLC2 inputs and DNp01/DNp02/DNp04/DNp11 outputs in the pinned escape circuit. Both sides; no edge threshold. Other neurons and incident edges omitted.',
    normalization:'Each retained edge uses its original contact count divided by the target incoming total in the 48311-neuron source graph. Omitted neurons contribute zero.',
    counts:{neurons:selected.length,edges:edges.length,contacts:edges.reduce((a,e)=>a+e[2],0)},
    neurons:selected,edges
  };
}
async function main(){
  await mkdir(cache,{recursive:true});
  const results=await Promise.allSettled(Object.keys(ASSETS).map(name=>asset(name,process.argv.includes('--download'))));
  for(const r of results)if(r.status==='rejected')throw r.reason;
  const [graph,circuit,csv]=results.map(r=>r.value),data=extract(graph,JSON.parse(circuit),csv.toString('utf8'));
  const json=JSON.stringify(data),digest=sha256(json);
  await mkdir(path.join(root,'dist','data'),{recursive:true});await mkdir(path.join(root,'data'),{recursive:true});
  await writeFile(path.join(root,'dist','data','malecns-escape.mjs'),'// Generated by scripts/import-malecns.mjs; anatomical data: CC BY 4.0.\nexport const CONNECTOME = '+json+';\nexport const CONNECTOME_SHA256 = '+JSON.stringify(digest)+';\n');
  await writeFile(path.join(root,'data','malecns-manifest.json'),JSON.stringify({id:data.id,dataset:data.dataset,sha256:digest,counts:data.counts,source:data.source,selection:data.selection,normalization:data.normalization},null,2)+'\n');
  console.log(JSON.stringify({counts:data.counts,sha256:digest}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
