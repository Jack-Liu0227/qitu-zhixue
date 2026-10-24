if(process.env.QITU_LIVE_ACCEPTANCE!=='1')throw Error('Set QITU_LIVE_ACCEPTANCE=1 to verify synthetic demo projects.');
const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.QITU_E2E_WEB||'http://122.51.130.204';
const root=require('node:os').tmpdir().replace(/\\/g,'/');
const dir=process.env.QITU_VISUAL_DIR||root+'/qitu-tools-display';fs.mkdirSync(dir,{recursive:true});
const ids=['zero8','thunder'].map(name=>fs.readFileSync(root+'/'+(process.env.QITU_RECORD_SOURCE_PREFIX||'qitu-tool-retest-')+name+'/'+name+'-project-url.txt','utf8').trim().split('/').pop());
(async()=>{
 const browser=await chromium.launch({headless:false});const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});const page=await context.newPage();
 const report={at:new Date().toISOString(),projects:ids,errors:[],writes:[]};
 page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))report.writes.push(new URL(r.url()).pathname)});
 async function api(path,data){const r=await context.request.fetch(base+'/api/v1'+path,{method:data?'POST':'GET',data});assert.ok(r.ok(),String(r.status()));const b=await r.json();return b.data??b;}
 try{
  const accounts=await api('/auth/test-accounts');await api('/auth/login',{...accounts.accounts.find(a=>a.role==='student'),deviceId:'courseware-display-student'});
  await context.storageState({path:dir+'/browser-state.json'});
  await page.goto(base+'/student/tutor/'+ids[0],{waitUntil:'domcontentloaded'});
  const card=page.locator('section[aria-label="双缝干涉探究"]').first();await card.waitFor({timeout:120000});
  const scene=card.getByRole('figure',{name:'波的传播与屏上条纹'});await scene.waitFor();
  assert.equal(await scene.getAttribute('data-motion'),'paused');report.reducedMotion=true;
  assert.equal(await scene.getByRole('button',{name:'已减少动态效果'}).isDisabled(),true);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await scene.getByRole('button',{name:'暂停波动演示'}).waitFor();
  const wave=scene.locator('circle[cy="105"]').first();
  const transform=await wave.evaluate(el=>getComputedStyle(el).transform);
  await page.waitForFunction(({el,before})=>getComputedStyle(el).transform!==before,{el:await wave.elementHandle(),before:transform});report.waveActuallyMoves=true;
  await scene.getByRole('button',{name:'暂停波动演示'}).click();assert.equal(await scene.getAttribute('data-motion'),'paused');report.pauseResume=true;
  const stopped=await wave.evaluate(el=>getComputedStyle(el).transform);
  await page.waitForTimeout(150);assert.equal(await wave.evaluate(el=>getComputedStyle(el).transform),stopped);
  await scene.getByRole('button',{name:'播放波动演示'}).click();assert.equal(await scene.getAttribute('data-motion'),'running');
  const screen=scene.getByRole('img',{name:'根据本次模型结果绘制的明暗条纹'});
  const before=await screen.innerHTML();await card.getByRole('slider',{name:'波长 λ'}).fill('650');
  await card.getByRole('button',{name:'重新演示',exact:true}).click();assert.notEqual(await screen.innerHTML(),before);
  await card.getByRole('button',{name:'重新演示',exact:true}).click();assert.equal(await card.locator('polyline').count(),2);report.repeatAndParameterResponse=true;
  await scene.screenshot({path:dir+'/optics-desktop.png'});
  await card.getByRole('button',{name:'全屏探究'}).click();assert.equal(await page.evaluate(()=>document.fullscreenElement?.getAttribute('aria-label')),'双缝干涉探究');
  await page.evaluate(()=>document.exitFullscreen());report.fullscreen=true;
  await page.setViewportSize({width:390,height:844});await scene.scrollIntoViewIfNeeded();await page.screenshot({path:dir+'/optics-mobile.png'});
  report.mobileGeometry=await card.evaluate(el=>{const rows=[];for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);rows.push({tag:node.tagName,cls:node.className,width:node.getBoundingClientRect().width,scroll:node.scrollWidth,minWidth:s.minWidth,display:s.display,flex:s.flex,overflow:s.overflow});}return rows;});
  assert.ok((await card.boundingBox()).width<=390);assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+2));report.mobileFits=true;
  await page.setViewportSize({width:1440,height:1100});
  report.boards=[];
  for(const id of ids){
   const session=await api('/tutor/session?projectId='+id);
   const expected=session.turns.flatMap(turn=>turn.blocks).filter(block=>block.kind==='board');
   assert.ok(expected.length,'The completed project must retain its generated boards');
   await page.goto(base+'/student/tutor/'+id,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(count=>document.querySelectorAll('.qitu-board-card').length===count,expected.length,{timeout:60000});
   for(let index=0;index<expected.length;index++){
    const board=page.locator('.qitu-board-card').nth(index);
    const details=board.locator('xpath=ancestor::details[1]');if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator('summary').first().click();
    const first=await board.locator('.qitu-board-caption').innerText();assert.equal(first,expected[index].steps[0].caption);
    for(let stepIndex=0;stepIndex<expected[index].steps.length;stepIndex++){
     const step=expected[index].steps[stepIndex];report.currentStep={projectId:id,board:index,step:stepIndex};
     if(stepIndex)await board.getByRole('button',{name:'下一页图示',exact:true}).click();
     assert.equal(await board.locator('.qitu-board-caption').innerText(),step.caption);
     if(step.mermaid)await board.locator('.qitu-mermaid-diagram-card svg').waitFor({state:'visible',timeout:30000});
     if(step.tex){assert.equal(await board.locator('.katex').count(),1);assert.equal(await board.locator('.katex-error').count(),0);}
     if(step.svg)await board.locator('.qitu-board-svg').waitFor();
     assert.equal(await board.locator('.qitu-mermaid-fallback-container,[role="alert"]').count(),0);
    }
    if(expected[index].steps.length>1)await board.getByRole('button',{name:'从头再看',exact:true}).click();
    assert.equal(await board.locator('.qitu-board-caption').innerText(),first);assert.equal(await board.locator('[aria-current="step"]').count(),1);
    if(expected[index].steps[0].mermaid)await board.locator('.qitu-mermaid-diagram-card svg').waitFor({state:'visible'});
    if(index===0)await board.screenshot({path:dir+'/'+id+'-board.png',animations:'disabled'});
   }
   report.boards.push({projectId:id,persisted:expected.length,rendered:await page.locator('.qitu-board-card').count(),allReplayed:true});
  }
  delete report.currentStep;report.allStepVisualsRendered=true;
  report.stepNavigation=true;assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.noEvidenceWrites=true;
  await context.storageState({path:dir+'/browser-state.json'});report.passed=true;
 }catch(e){report.failure=e.message;console.error(e);await page.screenshot({path:dir+'/failure.png',fullPage:true});process.exitCode=1;}
 finally{fs.writeFileSync(dir+'/visual-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})();
