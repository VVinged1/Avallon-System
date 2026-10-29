import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const bundle=await build({entryPoints:[path.join(root,'main.js')],bundle:true,format:'esm',platform:'browser',write:false,alias:{'@owlbear-rodeo/sdk':path.join(root,'scripts/fixtures/mockSdk.js')}});
const gmBundle=await build({entryPoints:[path.join(root,'gm-extension/main.js')],bundle:true,format:'esm',platform:'browser',write:false,alias:{'@owlbear-rodeo/sdk':path.join(root,'scripts/fixtures/mockSdk.js')}});
const server=http.createServer(async(req,res)=>{try {const url=new URL(req.url,'http://localhost');if(url.pathname==='/gm-extension/assets/main.js'){res.setHeader('Content-Type','text/javascript');res.end(gmBundle.outputFiles[0].text);return;}if(url.pathname==='/assets/main.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{});



try{
 const page=await browser.newPage({viewport:{width:1000,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('[data-od-action="add-item"]').waitFor({state:'attached'});await page.locator('summary').filter({hasText:/^Items/}).first().click();
 for(const itemKind of ['resource','artifact','prosthesis']){
  await page.locator('[data-od-action="add-item"]').click();await page.locator('dialog [name="kind"]').selectOption(itemKind);await page.locator('dialog [name="name"]').fill('Compact '+itemKind);
  const passive=page.locator('dialog [data-bonus-editor=""]');assert.equal(await passive.locator('[data-bonus-row]').count(),0);await passive.locator('[data-bonus-choice]').selectOption('a:Strength');await passive.locator('[data-bonus-add]').click();await passive.locator('[data-bonus-choice]').selectOption('s:Medicine');await passive.locator('[data-bonus-add]').click();await passive.locator('.od-new-bonus-skill>summary').click();await passive.locator('[data-new-bonus-name]').fill('Navigate the unknown');await passive.locator('[data-new-bonus-category] select').selectOption('control');await passive.locator('[data-bonus-new]').click();assert.equal(await passive.locator('[data-bonus-row]').count(),3);
  await page.locator('dialog [data-add-ability]').click();await page.locator('dialog [name="abilityName"]').fill('Navigator power');await page.locator('dialog [name="abilityCost"]').fill('0.5');
  for(const width of [360,480,620,1000]){
   await page.setViewportSize({width,height:1100});
   for(const kind of ['skill','bonus','attack','utility']){
    await page.locator('dialog [name="abilityKind"]').selectOption(kind);
    if(kind==='bonus'){const bonus=page.locator('dialog [data-bonus-editor="ability"]');if(!await bonus.locator('[name="abilityAttr:Reaction"]').count()){await bonus.locator('[data-bonus-choice]').selectOption('a:Reaction');await bonus.locator('[data-bonus-add]').click();}await bonus.locator('.od-new-bonus-skill').evaluate(e=>e.open=true);}
    await page.locator('dialog [name="abilityKind"]').scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const issues=await page.locator('dialog').evaluate(dialog=>{const problems=[],bounds=dialog.getBoundingClientRect();if(dialog.scrollWidth>dialog.clientWidth+1)problems.push('horizontal overflow');for(const e of dialog.querySelectorAll('input:not([type=hidden]),select')){const r=e.getBoundingClientRect();if(!r.height||e.type==='checkbox')continue;if(r.left<bounds.left||r.right>bounds.right)problems.push(e.name+' outside dialog');if(r.width<60)problems.push(e.name+' too narrow');}for(const row of dialog.querySelectorAll('.od-ability-heading,.od-ability-numbers,.od-compact-bonus-picker,.od-bonus-new-fields')){const labels=[...row.children].filter(e=>e.tagName==='LABEL'&&e.getBoundingClientRect().height);for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].getBoundingClientRect(),b=labels[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)problems.push('overlapping labels');}}return problems;});assert.deepEqual(issues,[],itemKind+' / '+width+'px / '+kind);
    if(process.env.AVALLON_SCREENSHOT_DIR&&[360,620].includes(width)&&kind==='bonus'){await fs.mkdir(process.env.AVALLON_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AVALLON_SCREENSHOT_DIR,itemKind+'-'+width+'.png')});}
   }
  }
  await page.locator('dialog [data-cancel]').click();
 }
 assert.deepEqual(errors,[]);console.log('Compact modifiers and all ability types pass for resources/artifacts/prostheses at 360/480/620/1000 px.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
