// Run only against the disposable fixture, with Playwright available.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs');
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE_REPORT));
const WEB = process.env.TARGET_URL || 'http://127.0.0.1:43101';
const API = process.env.API_ORIGIN || 'http://127.0.0.1:44100';
assert.equal(process.env.QITU_DISPOSABLE_FIXTURE, 'yes');
for (const endpoint of [WEB, API]) assert.equal(new URL(endpoint).hostname, '127.0.0.1');
assert.equal(new URL(API).port, '44100');
assert.ok(process.env.QITU_TEST_STUDENT_PASSWORD && process.env.QITU_TEST_PARENT_PASSWORD);

async function runtimeChecks() {
 const browser = await chromium.launch({headless:false}); const checks=[];
 try {
  const context=await browser.newContext();
  assert.equal((await context.request.post(API+'/api/v1/auth/login',{data:{email:'student@qtzx.local',password:process.env.QITU_TEST_STUDENT_PASSWORD}})).status(),201);
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(WEB+'/student/tutor/'+fixture.projectId,{waitUntil:'domcontentloaded'});
  await page.getByText('此前的模拟观察已保存，可在项目证据中查看。').waitFor(); checks.push('reload-persisted-observation');
  await page.getByRole('radio').first().check();
  await page.getByRole('button',{name:'确认预测并解锁仿真',exact:true}).click();
  await page.getByRole('button',{name:'运行仿真',exact:true}).waitFor();
  await page.getByRole('button',{name:'运行仿真',exact:true}).click();
  await page.getByRole('button',{name:'仿真已运行',exact:true}).waitFor();
  const observation=page.getByRole('textbox',{name:'我的观察（模拟）'});
  await observation.fill('Synthetic browser observation: the central band changes with slit width.');
  const actionUrl='**/interactive/experiments/*/action';let lost=false;const observationKeys=[];
  await page.route(actionUrl,async route=>{
   const request=route.request();const data=request.postDataJSON();
   if(data.action==='record_observation') {
    observationKeys.push(data.idempotencyKey);
    if(!lost){lost=true;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');return;}
   }
   await route.continue();
  });
  await page.getByRole('button',{name:'记录观察',exact:true}).click();
  await page.getByText(/网络|失败|fetch/i).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'已保存模拟观察',exact:true}).count(),0);
  await page.getByRole('button',{name:'记录观察',exact:true}).click();
  await page.getByRole('button',{name:'已保存模拟观察',exact:true}).waitFor();
  assert.equal(observationKeys.length,2);assert.equal(observationKeys[0],observationKeys[1]);checks.push('lost-save-response-retry-same-key');
  await page.unroute(actionUrl);
  await page.getByRole('button',{name:'介质散射仿真',exact:true}).click();
  await page.getByRole('button',{name:'请先提交预测以解锁运行',exact:true}).waitFor();checks.push('model-switch-relocks-prediction');
  await page.getByRole('radio').first().check();await context.setOffline(true);
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('button',{name:'\u786e\u8ba4\u9884\u6d4b\u5e76\u89e3\u9501\u4eff\u771f',exact:true}).isDisabled(),true);
  await context.setOffline(false);checks.push('offline-no-false-success');
  await page.reload({waitUntil:'domcontentloaded'});await page.getByText('此前的模拟观察已保存，可在项目证据中查看。').waitFor();checks.push('refresh-receipt');
  const stranger=await browser.newContext();await stranger.request.post(API+'/api/v1/auth/login',{data:{email:'student2@qtzx.local',password:process.env.QITU_TEST_STUDENT_PASSWORD}});
  assert.equal((await stranger.request.get(API+'/api/v1/tutor/sessions/'+fixture.sessionId)).status(),403);checks.push('cross-student-403');await stranger.close();
  const parent=await browser.newContext();await parent.request.post(API+'/api/v1/auth/login',{data:{email:'parent@qtzx.local',password:process.env.QITU_TEST_PARENT_PASSWORD}});
  const allowed=await parent.request.get(API+'/api/v1/parent/children/student-demo/profile');assert.equal(allowed.status(),200);
  assert.equal((await allowed.json()).data.freshness,'unavailable');
  assert.equal((await parent.request.get(API+'/api/v1/parent/children/student-demo-4/profile')).status(),403);checks.push('parent-accepted-only-and-403');await parent.close();
  await page.goto(WEB+'/student/tutor?new=1',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'发送想法',exact:true}).waitFor({timeout:30000});
  const sse=[];page.on('response',r=>{if(r.url().endsWith('/stream'))sse.push(r)});
  const chat=page.locator('textarea').last();await chat.fill('I want to explore how light changes when passing through a narrow slit.');
  await page.getByRole('button',{name:'发送想法',exact:true}).click();
  await page.getByRole('button',{name:'发送想法',exact:true}).waitFor({timeout:30000});
  assert.ok(sse.some(r=>r.status()===200));checks.push('real-sse-turn');

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks,errors}));
 } finally {await browser.close();}
}

async function replayChecks(){const browser=await chromium.launch({headless:false});try{const context=await browser.newContext();const api=API+'/api/v1';await context.request.post(api+'/auth/login',{data:{email:'student@qtzx.local',password:process.env.QITU_TEST_STUDENT_PASSWORD}});const page=await context.newPage();await page.goto(WEB+'/student/tutor?new=1',{waitUntil:'domcontentloaded'});const stamp=Date.now();const planResponse=await context.request.post(api+'/learning-plans',{data:{interest:'Synthetic confirmation '+stamp,lessonCount:16,lessonMinutes:60,curriculumSlug:'optics-physical-inquiry-16s'}});assert.equal(planResponse.status(),201);const plan=(await planResponse.json()).data.plan;assert.equal(plan.projectId,null);
let committed;let lost=false;await page.route('**/learning-plans/*/confirm',async route=>{if(!lost){lost=true;const response=await route.fetch();assert.equal(response.status(),200);committed=(await response.json()).data.project.id;await route.abort('failed');}else await route.continue();});
const confirm=()=>page.evaluate(async({id,key})=>{try{const response=await fetch('/api/v1/learning-plans/'+id+'/confirm',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:'{}'});return {status:response.status,body:await response.json()};}catch{return {lost:true}}},{id:plan.id,key:'browser-confirm-'+stamp});assert.deepEqual(await confirm(),{lost:true});const retry=await confirm();assert.equal(retry.status,200);assert.equal(retry.body.data.project.id,committed);assert.equal(retry.body.data.replayed,true);
const explorationResponse=await context.request.post(api+'/explorations',{headers:{'idempotency-key':'browser-exp-'+stamp},data:{source:'free'}});assert.equal(explorationResponse.status(),201);const exploration=(await explorationResponse.json()).data;const session=(await (await context.request.get(api+'/tutor/session?explorationId='+exploration.id)).json()).data;assert.ok(session.sessionId);
let frames;await page.route('**/sessions/*/stream',async route=>{frames=await (await route.fetch()).text();await route.abort('failed');});const turn={content:'Synthetic question about a narrow slit.',idempotencyKey:'browser-sse-'+stamp};await page.evaluate(async({id,turn})=>{try{await fetch('/api/v1/tutor/sessions/'+id+'/stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(turn)});}catch{}},{id:session.sessionId,turn});assert.match(frames,/event: turn\.done/);await page.unroute('**/sessions/*/stream');const before=(await (await context.request.get(api+'/tutor/sessions/'+session.sessionId)).json()).data;const replay=await context.request.post(api+'/tutor/sessions/'+session.sessionId+'/stream',{data:turn});assert.equal(replay.status(),200);assert.match(await replay.text(),/event: turn\.done/);const after=(await (await context.request.get(api+'/tutor/sessions/'+session.sessionId)).json()).data;assert.equal(after.lastSeq,before.lastSeq);assert.equal(after.turns.length,before.turns.length);console.log(JSON.stringify({checks:['lost-confirmation-response-replays-one-project','lost-sse-response-replays-without-duplicate-turns']}));}finally{await browser.close();}}

(async()=>{await runtimeChecks();await replayChecks();})().catch(e=>{console.error(e);process.exitCode=1});
