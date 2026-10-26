import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(root,'standalone');
const modules=['data/malecns-escape.mjs','data/malecns-motor.mjs','data/malecns-neurotransmitters.mjs','neurochemistry.mjs','motor.mjs','experience.mjs','neural.mjs','reflex.mjs','engine.mjs','experiments.mjs','app.mjs'];
const script='(function(){\n"use strict";\n'+modules.map(name=>readFileSync(path.join(root,'dist',name),'utf8')
  .replace(/^import[^\n]+\n/gm,'').replace(/^export\s*\{[^}]*\};?\r?\n/gm,'').replace(/^export\s+/gm,'')).join('\n')+'\n})();';
new Function(script);
const css=readFileSync(path.join(root,'dist','style.css'),'utf8').replace(/^@charset[^;]*;/,'');
let html=readFileSync(path.join(root,'dist','index.html'),'utf8');
html=html.replace('href="lab.html"','href="http://127.0.0.1:4177/lab.html" title="Полный режим требует npm start"');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+css+'</style>');
html=html.replace('<script type="module" src="app.mjs"></script>',()=>'<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
mkdirSync(out,{recursive:true});const destination=path.join(out,'malecns-warhammer.html');writeFileSync(destination,html,'utf8');
console.log(JSON.stringify({file:destination,bytes:Buffer.byteLength(html),selfContained:!/<script[^>]+src=|<link[^>]+stylesheet/.test(html)}));
