if(process.env.QITU_LIVE_ACCEPTANCE!=='1')throw Error('Set QITU_LIVE_ACCEPTANCE=1 to verify the demo student records.');
const {chromium,request}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=process.env.QITU_E2E_WEB||'http://122.51.130.204',root=require('node:os').tmpdir().replace(/\\/g,'/')+'/';
const targets=(process.env.QITU_RECORD_TARGETS||'zero8,thunder').split(',');
const sourcePrefix=process.env.QITU_RECORD_SOURCE_PREFIX||'qitu-live-';
const directory=process.env.QITU_RECORD_DIR||root+'qitu-live-final-records';fs.mkdirSync(directory,{recursive:true});
async function json(client,path,data){const r=await client.fetch(base+'/api/v1'+path,{method:data?'POST':'GET',data,headers:{'idempotency-key':crypto.randomUUID()}});const b=await r.json();if(!r.ok())throw Error(r.status()+' '+path+' '+JSON.stringify(b));return b.data??b;}
(async()=>{
 const browser=await chromium.launch({headless:false});const context=await browser.newContext({viewport:{width:1760,height:1100},...(process.env.QITU_RECORD_REUSE==='1'?{storageState:directory+'/browser-state.json'}:{})});const page=await context.newPage();const report={at:new Date().toISOString(),phase:process.env.QITU_RECORD_PHASE||'pre-restart',projects:[],issues:[]};
 page.on('pageerror',e=>report.issues.push(e.message));
 try{
  const restoredSession=process.env.QITU_RECORD_REUSE==='1'?await context.request.get(base+'/api/v1/auth/me'):null;
  if(process.env.QITU_RECORD_REUSE!=='1'||restoredSession?.status()===401){
   if(restoredSession)report.reloginRequiredAfterRestart=true;
   const accounts=await json(context.request,'/auth/test-accounts');const account=accounts.accounts.find(a=>a.role==='student');
   await json(context.request,'/auth/login',{...account,deviceId:'live-acceptance-student'});
   await context.storageState({path:directory+'/browser-state.json'});
  }
  for(const target of targets){
   const url=fs.readFileSync(root+sourcePrefix+target+'/'+target+'-project-url.txt','utf8').trim(),id=url.split('/').pop();
   const current=await json(context.request,'/tutor/project-context?projectId='+id),lesson=current.lesson;
   const progress=await json(context.request,'/learning-plans/'+lesson.planId+'/progress');
   assert.equal(progress.completedCount,8);assert.equal(progress.totalCount,8);assert.equal(current.project.stage,'completed');
   await page.goto(url,{waitUntil:'domcontentloaded'});
   const aside=page.getByRole('complementary',{name:'项目进度与团队智能体'});
   await page.getByRole('textbox',{name:'输入你的想法'}).waitFor({timeout:120000});
   await page.getByRole('button',{name:'发送想法',exact:true}).waitFor({timeout:120000});
   await page.locator('.qitu-tutor-thread-loading').waitFor({state:'hidden',timeout:60000});
   if(!await aside.isVisible())await page.getByRole('button',{name:'项目与进度',exact:true}).click();
   const schedule=page.getByRole('region',{name:'课时安排',exact:true});await schedule.getByText('已完成 8 / 8 课时',{exact:true}).waitFor({timeout:120000});
   assert.equal(await aside.getByRole('region',{name:'本课课件',exact:true}).count(),0);
   assert.equal(await page.locator('details[aria-label="本课记录与评价"]').evaluate(el=>el.open),false);
   const item={target,url,stage:current.project.stage,planId:lesson.planId,planRevision:progress.planRevision,lessons:[]};
   for(const session of progress.sessions){
    const evidence=await json(context.request,`/learning-plans/${lesson.planId}/sessions/${encodeURIComponent(session.sessionId)}/evidence?planRevision=${progress.planRevision}`);
    const row=schedule.locator('.qitu-lesson-schedule > li').nth(session.lessonIndex-1);
    await row.getByRole('button',{name:'查看本课记录',exact:true}).click();
    const records=row.getByRole('region',{name:`第${session.lessonIndex}课学习记录`,exact:true});
    await records.locator('pre').first().waitFor({timeout:60000});
    assert.equal(await records.getByRole('alert').count(),0);
    const body=await records.innerText();assert.match(body,/线上合成/);
    const proof=[...evidence.submissions,...evidence.observations,...evidence.reflections];
    assert.ok(proof.length);assert.ok(proof.every(p=>p.quality?.status==='accepted'));
    const summaries=[];
    for(const entry of proof.filter(p=>p.artifactId)){
     const artifact=await json(context.request,'/artifacts/'+entry.artifactId);
     assert.equal(artifact.latestVersion.id,entry.artifactVersionId);
     if(target==='thunder'&&session.lessonIndex===7&&entry.kind==='submitted_artifact'){
      const code=artifact.latestVersion.inlineText.split('完整源码 game.py：\n')[1];assert.ok(code?.includes('class Game:'));
      const digest=crypto.createHash('sha256').update(code.trimEnd()+'\n').digest('hex');
      const expected=JSON.parse(fs.readFileSync(root+sourcePrefix+'thunder/flow-result.json','utf8')).gameRuns[7].sourceSha256;
      assert.equal(digest,expected);item.playableArtifactSourceVerified=true;
     }
     summaries.push({artifactId:artifact.id,versionId:entry.artifactVersionId,contentSha256:crypto.createHash('sha256').update(artifact.latestVersion.inlineText).digest('hex')});
    }
    item.lessons.push({lesson:session.lessonIndex,title:session.title,completedAt:session.completedAt,visible:true,
      responses:evidence.submissions.length,observations:evidence.observations.length,reflections:evidence.reflections.length,
      approvedArtifacts:evidence.approvedArtifacts.length,proofRefs:proof.map(p=>p.ref),artifacts:summaries});
    await records.locator('pre').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:directory+`/${target}-lesson-${session.lessonIndex}-records.png`,clip:await aside.boundingBox()});
    await row.getByRole('button',{name:'收起本课记录',exact:true}).click();
   }
   const first=schedule.locator('.qitu-lesson-schedule > li').first();
   await context.setOffline(true);await first.getByRole('button',{name:'查看本课记录',exact:true}).click();
   const offline=first.getByRole('region',{name:'第1课学习记录',exact:true});await offline.getByRole('alert').waitFor({timeout:30000});
   await context.setOffline(false);await offline.getByRole('button',{name:'重试读取本课记录'}).click();await offline.locator('pre').first().waitFor({timeout:60000});
   item.offlineRecovery=true;
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'课时安排',exact:true}).getByText('已完成 8 / 8 课时',{exact:true}).waitFor({timeout:120000});item.reloadPersisted=true;
   report.projects.push(item);fs.writeFileSync(directory+'/records-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({target,completed:8,visibleLessons:8,offlineRecovery:true,reloadPersisted:true,url}));
  }
  const anonymous=await request.newContext();const p=report.projects[0],s=p.lessons[0];
  const noAuth=await anonymous.get(base+`/api/v1/learning-plans/${p.planId}/sessions/${encodeURIComponent(p.planId+(p.target==='thunder'?':thunder-session-1':':wave-session-1'))}/evidence?planRevision=${p.planRevision}`);assert.equal(noAuth.status(),401);report.anonymousRecordDenied=true;await anonymous.dispose();
  await page.goto(base+'/student/inspiration',{waitUntil:'domcontentloaded'});
  await page.locator('article').filter({has:page.getByRole('heading',{name:'雷霆战机',exact:true})}).waitFor({timeout:60000});
  assert.equal(await page.locator('article').count(),2);report.visibleTemplates=2;
  assert.deepEqual(report.issues,[]);report.passed=true;
 }catch(e){report.failure=e.message;console.error(e);await page.screenshot({path:directory+'/failure.png',fullPage:true});fs.writeFileSync(directory+'/failure.txt',await page.locator('body').innerText());process.exitCode=1;}
 finally{fs.writeFileSync(directory+'/records-result.json',JSON.stringify(report,null,2));fs.writeFileSync(directory+'/'+report.phase+'-records-result.json',JSON.stringify(report,null,2));await browser.close();}
})();
