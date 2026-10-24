if(process.env.QITU_LIVE_ACCEPTANCE!=='1')throw Error('Explicit synthetic acceptance is required.');
const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),os=require('node:os');
const base=process.env.QITU_E2E_WEB||'http://122.51.130.204';
const dir=process.env.QITU_VISUAL_DIR||os.tmpdir().replace(/\\/g,'/')+'/qitu-dynamic-experiment-visible';
const phase=process.env.QITU_VISIBILITY_PHASE||'after';fs.mkdirSync(dir,{recursive:true});
const projectId='proj-331436f4-6e93-4736-9c54-12b604241ab4';
(async()=>{
 const browser=await chromium.launch({headless:false});
 const context=await browser.newContext({viewport:{width:1760,height:1100}}),page=await context.newPage();
 const report={at:new Date().toISOString(),projectId,phase,errors:[],writes:[]};
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))report.writes.push(new URL(r.url()).pathname);});
 async function read(path,data){const r=await context.request.fetch(base+'/api/v1'+path,{method:data?'POST':'GET',data});assert.equal(r.status(),data?201:200);const b=await r.json();return b.data??b;}
 try{
  const accounts=await read('/auth/test-accounts');
  const login=await context.request.post(base+'/api/v1/auth/login',{data:{...accounts.accounts.find(a=>a.role==='student'),deviceId:'courseware-display-student'}});assert.ok(login.ok());
  const session=await read('/tutor/session?projectId='+projectId);
  const expected=new Set(session.turns.flatMap(turn=>turn.blocks).filter(b=>b.kind==='optics_experiment'&&b.specVersion==='2.0.0').map(b=>b.experimentId));
  await page.goto(base+'/student/tutor/'+projectId,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(count=>document.querySelectorAll('details[data-saved-experiment]').length===count,expected.size,{timeout:90000});
  const cards=page.locator('details[data-saved-experiment]');
  report.savedExperiments=expected.size;report.initiallyOpen=await cards.evaluateAll(items=>items.filter(item=>item.open).length);
  assert.ok(expected.size>0);assert.equal(report.initiallyOpen,expected.size,'Saved interactive experiments must be visible immediately, without the test expanding them');
  for(const card of await cards.all())await card.getByRole('figure',{name:'波的传播与屏上条纹'}).waitFor({state:'visible'});
  const access=page.getByRole('group',{name:'已保存动态实验',exact:true});
  assert.equal(await access.getByRole('button').count(),expected.size);
  const first=cards.first(),id=await first.getAttribute('id');
  await first.locator('summary').click();assert.equal(await first.evaluate(el=>el.open),false);
  await access.getByRole('button').first().click();
  assert.equal(await first.evaluate(el=>el.open),true);
  await page.waitForFunction(anchor=>{const r=document.getElementById(anchor).getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;},id);
  const scene=first.getByRole('figure',{name:'波的传播与屏上条纹'});await scene.waitFor({state:'visible'});
  await first.getByRole('button',{name:'重新演示',exact:true}).click();
  await first.getByRole('button',{name:'重新演示',exact:true}).click();
  assert.equal(await cards.count(),expected.size);report.jumpReopensOriginal=true;report.repeatReplay=true;
  await scene.screenshot({path:dir+'/dynamic-experiment-visible.png',animations:'disabled'});
  await access.screenshot({path:dir+'/dynamic-experiment-access.png'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(count=>document.querySelectorAll('details[data-saved-experiment][open]').length===count,expected.size,{timeout:90000});
  report.reloadVisible=true;assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);report.noEvidenceWrites=true;report.passed=true;
 }catch(error){report.failure=error.message;console.error(error);await page.screenshot({path:dir+'/'+phase+'-failure.png'});process.exitCode=1;}
 finally{fs.writeFileSync(dir+'/'+phase+'-visibility-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})();
