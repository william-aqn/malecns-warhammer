import {FullLab} from './full-lab.mjs';
let lab=null,queue=Promise.resolve();
async function verifiedFile(name,entry){
  postMessage({event:'progress',message:'Загрузка '+name});
  const res=await fetch('/full-cns/'+name);if(!res.ok)throw Error('Нет полного набора данных. В каталоге проекта выполните npm run data:full -- --download.');
  const bytes=await res.arrayBuffer();if(bytes.byteLength!==entry.bytes)throw Error('Размер файла не совпадает: '+name);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==entry.sha256)throw Error('Контрольная сумма не совпадает: '+name);return bytes;
}
async function handle({id,action,payload}){
  try{
    let result;
    if(action==='init'){
      if(!lab){
        const response=await fetch('/full-cns/manifest.json');if(!response.ok)throw Error('Полный MaleCNS ещё не собран. Выполните npm run data:full -- --download в каталоге проекта.');
        const manifest=await response.json();
        // Sequential loading bounds peak memory and gives useful progress messages.
        const graph=await verifiedFile('graph.bin',manifest.files['graph.bin']);
        const annotations=JSON.parse(new TextDecoder().decode(await verifiedFile('neurons.json',manifest.files['neurons.json'])));
        const retina=JSON.parse(new TextDecoder().decode(await verifiedFile('retina.json',manifest.files['retina.json'])));
        postMessage({event:'progress',message:'Подключение 166 700 нейронов и сенсорных портов…'});
        lab=new FullLab(graph,annotations,retina,manifest);
      }
      result={metadata:lab.metadata(),state:lab.view()};
    }else{
      if(!lab)throw Error('Сначала загрузите сеть');
      if(action==='step')result=lab.step(payload?.manual??null);
      else if(action==='configure'){lab.configure(payload);result=lab.view();}
      else if(action==='reset'){lab.reset(payload?.seed,payload?.preset);result=lab.view();}
      else if(action==='edit'){lab.edit(payload);result=lab.view();}
      else if(action==='snapshot')result=lab.snapshot();
      else if(action==='restore'){lab.restore(payload);result=lab.view();}
      else if(action==='inspect')result=lab.inspect(payload);
      else throw Error('Неизвестная команда');
    }
    postMessage({id,result});
  }catch(error){postMessage({id,error:error.message});}
}
onmessage=event=>{queue=queue.then(()=>handle(event.data)).catch(error=>postMessage({id:event.data?.id,error:error.message}));};
