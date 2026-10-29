import fs from 'node:fs';import path from 'node:path';
const root=fs.realpathSync(process.cwd()),output=path.resolve(root,'.site');
if(output!==path.join(root,'.site')||!output.startsWith(root+path.sep))throw Error('Invalid output folder');
if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('Refusing symlink output');
if(fs.existsSync(output))fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output);
const copy=(from,to=from)=>{const dest=path.join(output,to);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(root,from),dest,{recursive:true});};
for(const file of ['manifest.json','index.html','background.html','icon.svg','styles.css','theme.css','overlay-runtime-sw.js','add.svg','remove.svg','heart.svg','LICENSE','THIRD_PARTY_NOTICES.md','PROVENANCE.md'])copy(file);
copy('assets');for(const dir of ['gm-extension','room-log','initiative']){for(const file of ['manifest.json','index.html'])copy(dir+'/'+file);if(fs.existsSync(path.join(root,dir,'styles.css')))copy(dir+'/styles.css');if(fs.existsSync(path.join(root,dir,'icon.svg')))copy(dir+'/icon.svg');copy(dir+'/assets');}
copy('ui/combatLayout.css');
const base='https://vvinged1.github.io/Avallon-System/';for(const name of ['manifest.json','gm-extension/manifest.json','room-log/manifest.json','initiative/manifest.json']){const m=JSON.parse(fs.readFileSync(path.join(output,name),'utf8'));for(const url of [m.icon,m.background_url,m.action?.icon,m.action?.popover].filter(Boolean)){if(!url.startsWith(base))throw Error('Unexpected manifest host '+url);const file=decodeURIComponent(new URL(url).pathname.slice('/Avallon-System/'.length));if(!fs.existsSync(path.join(output,file)))throw Error('Missing manifest file '+file);}}
for(const file of ['assets/main.js','gm-extension/assets/main.js','room-log/assets/main.js','initiative/assets/main.js'])if(fs.readFileSync(path.join(output,file),'utf8').includes('window.avallonTest'))throw Error('Mock SDK leaked into production');
console.log('Static site staged: all four manifests resolve; production bundles contain no SDK fixture.');
