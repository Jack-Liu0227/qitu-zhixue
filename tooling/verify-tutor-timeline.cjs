if(process.env.QITU_LIVE_ACCEPTANCE!=='1')throw Error('Explicit synthetic acceptance is required.');
const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),os=require('node:os');
const root=os.tmpdir().replace(/\\/g,'/'),dir=root+'/qitu-autonomous-display';
const base=process.env.QITU_E2E_WEB||'http://122.51.130.204';
(async()=>{
 const browser=await chromium.launch({headless:false});
 const context=await browser.newContext({viewport:{width:1760,height:1100},storageState:root+'/qitu-autonomous-final-records/browser-state.json'});
 const page=await context.newPage(),report={at:new Date().toISOString(),projects:[],errors:[]};
 page.on('pageerror',error=>report.errors.push(error.message));
 async function read(path){const response=await context.request.get(base+'/api/v1'+path);assert.equal(response.status(),200);const body=await response.json();return body.data??body;}
 try{
  for(const target of ['zero8','thunder']){
   const url=fs.readFileSync(root+'/qitu-autonomous-live-'+target+'/'+target+'-project-url.txt','utf8').trim(),projectId=url.split('/').pop();
   const session=await read('/tutor/session?projectId='+projectId);
   const blocks=session.turns.flatMap(turn=>turn.blocks),boards=blocks.filter(block=>block.kind==='board');
   const experiments=blocks.filter(block=>block.kind==='optics_experiment'&&block.specVersion==='2.0.0');
   await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(count=>document.querySelectorAll('.qitu-chat-bubble').length===count,session.turns.length,{timeout:120000});
   assert.equal(await page.locator('.qitu-board-card').count(),boards.length);
   const savedBoards=page.locator('details[data-saved-courseware]');
   assert.ok(await savedBoards.evaluateAll(items=>items.every(item=>item.open)),'Historical courseware must be expanded in its original message');
   const savedExperiments=page.locator('details[data-saved-experiment]');
   assert.equal(await savedExperiments.count(),new Set(experiments.map(block=>block.experimentId)).size);
   assert.ok(await savedExperiments.evaluateAll(items=>items.every(item=>item.open)),'Saved dynamic experiments must be expanded on initial load');
   for(const block of experiments){
    const entry=savedExperiments.filter({has:page.locator('summary').filter({hasText:'第 '+block.sessionIndex+' 课'})});
    assert.ok(await entry.count());
   }
   const archive=page.getByRole('region',{name:'对话中的学习记录',exact:true});
   await archive.locator(':scope > details').nth(7).waitFor({timeout:60000});
   assert.equal(await archive.locator(':scope > details').count(),8);
   await archive.locator(':scope > details > summary').first().click();
   await archive.locator('pre').first().waitFor({timeout:60000});
   assert.equal(await archive.getByRole('alert').count(),0);
   const item={target,turns:session.turns.length,boards:boards.length,uniqueExperiments:await savedExperiments.count(),visibleLessonRecords:8};
   if(target==='zero8'){
    const card=page.getByRole('region',{name:'本课课件',exact:true}),select=card.locator('select');
    await select.waitFor({timeout:60000});const old=await select.locator('option').first().getAttribute('value');
    await select.selectOption(old);const title=await card.getByRole('heading',{level:4}).innerText();
    const aside=page.getByRole('complementary',{name:'项目进度与团队智能体'});
    if(!await aside.isVisible())await page.getByRole('button',{name:'项目与进度',exact:true}).click();
    const dock=page.locator('details[aria-label="本课记录与评价"]');
    if(!await dock.evaluate(node=>node.open))await dock.locator('summary').click();
    let slow=true;
    await page.route('**/lesson/courseware',async route=>{if(slow)await new Promise(resolve=>setTimeout(resolve,1200));await route.continue();});
    const refresh=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/lesson/courseware'));
    await page.locator('.qitu-chat-thread').evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
    await page.getByRole('button',{name:'刷新课时与评价',exact:true}).click();
    assert.equal(await card.getByRole('heading',{level:4}).innerText(),title);
    await refresh;slow=false;
    await page.waitForTimeout(250);
    assert.equal(await select.inputValue(),old);
    assert.equal(await card.getByRole('heading',{level:4}).innerText(),title);
    assert.ok(await page.locator('.qitu-chat-thread').evaluate(node=>node.scrollTop<20));
    item.selectedCoursewareSurvivesRefresh=true;item.readingPositionPreserved=true;
    await page.locator('.qitu-board-card').first().screenshot({path:dir+'/saved-timeline-courseware.png',animations:'disabled'});
   }
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(count=>document.querySelectorAll('.qitu-chat-bubble').length===count,session.turns.length,{timeout:60000});
   assert.equal(await page.locator('.qitu-board-card').count(),boards.length);
   item.reloadKeepsAllTurnsAndBoards=true;report.projects.push(item);
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(error){report.failure=error.message;console.error(error);await page.screenshot({path:dir+'/timeline-failure.png',fullPage:true});process.exitCode=1;}
 finally{fs.writeFileSync(dir+'/timeline-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})();
