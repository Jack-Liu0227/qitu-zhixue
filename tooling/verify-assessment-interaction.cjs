// Browser-only response fixtures. Every write is intercepted; no learner facts are created.
const {chromium}=require('playwright');const fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:os').tmpdir().replace(/\\/g,'/');
const base=process.env.QITU_E2E_WEB||'http://122.51.130.204',dir=process.env.QITU_VISUAL_DIR||root+'/qitu-tools-display';
(async()=>{
 const browser=await chromium.launch({headless:false});const context=await browser.newContext({viewport:{width:1440,height:1100},storageState:dir+'/browser-state.json'});const page=await context.newPage();
 const report={environment:'browser-only-response-fixture-no-production-writes',requests:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
 const fixture=JSON.parse(fs.readFileSync(process.env.QITU_ASSESSMENT_FIXTURE||root+'/qitu-tool-retest-zero8/context.json','utf8'));
 const projectId=fixture.project.id,lesson=fixture.lesson;lesson.status='current';lesson.assessmentAvailable=true;lesson.teachingMode='zero-base.v1';
 lesson.currentActivity={...lesson.currentActivity,kind:'check',evidence:'mastery'};
 const scope={planId:lesson.planId,planRevision:lesson.planRevision,learningSessionId:lesson.learningSessionId};
 let questionIndex=1,failOnce=true,answerCount=0,hints=0;
 const currentQuestion=()=>({questionId:'browser-fixture-'+questionIndex,prompt:'界面隔离测试：保持其他条件不变，减小缝宽后，中央亮带怎样变化？',questionType:'choice',options:[{id:'a',label:'A',body:'变宽'},{id:'b',label:'B',body:'变窄'}],allowFreeText:false,attempt:questionIndex});
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/v1/tutor/project-context')return route.fulfill({json:{data:fixture}});
  if(req.method()==='GET')return route.continue();
  const body=req.postDataJSON();report.requests.push({path,key:req.headers()['idempotency-key']});
  if(path.endsWith('/assessment'))return route.fulfill({json:{data:{projectId,scope,blockedReason:null,nextStep:{action:'probe',objectiveId:'fixture-objective',knowledgeType:'concept',status:'learning',gate:'qualitative',mastery:0,threshold:1,reason:'Fixture',theoryMastered:false,practiceUnlocked:false,question:currentQuestion()}}}});
  if(path.endsWith('/assessment/answers')){
   if(failOnce){failOnce=false;return route.fulfill({status:503,json:{message:'隔离测试：暂时未保存，请重试。'}});}
   answerCount++;const correct=body.answer==='a';questionIndex++;
   return route.fulfill({json:{data:{projectId,scope,answer:{questionId:body.questionId,result:correct?'correct':'incorrect',isCorrect:correct,score:correct?1:0,explanation:correct?'缝宽减小，中央亮带变宽。':'请结合缝宽与中央亮带宽度的关系再想一想。',errorType:correct?null:'concept',remediation:correct?null:'先比较一个变量，再解释变化。',mastery:null,theoryMastered:correct,practiceUnlocked:correct,replayed:false}}}});
  }
  if(path.endsWith('/stream')){
   hints++;assert.match(body.content,/不要透露答案或更换题目/);
   return route.fulfill({contentType:'text/event-stream',body:'event: block\ndata: '+JSON.stringify({seq:1,block:{kind:'hint',level:1,text:'先想想缝宽和中央亮带宽度的关系。'}})+'\n\nevent: done\ndata: '+JSON.stringify({seq:2,turnSummary:{hintLevel:1,stage:fixture.project.stage}})+'\n\n'});
  }
  return route.fulfill({status:409,json:{message:'UI fixture blocks all other writes'}});
 });
 try{
  await page.goto(base+'/student/tutor/'+projectId,{waitUntil:'domcontentloaded'});const card=page.getByRole('region',{name:'本课目标考核'});
  await card.getByRole('radio',{name:'B 变窄',exact:true}).check({timeout:120000});
  await card.getByRole('button',{name:'给我一点提示'}).click();await page.waitForFunction(el=>!el.disabled,await card.getByRole('button',{name:'给我一点提示'}).elementHandle(),{timeout:60000});
  assert.equal(hints,1);assert.equal(answerCount,0);assert.equal(await card.getByRole('radio',{name:'B 变窄',exact:true}).isChecked(),true);report.helpPreservesQuestionAndSelection=true;
  await page.reload({waitUntil:'domcontentloaded'});await card.locator('input[name="lesson-browser-fixture-1"]').first().waitFor({timeout:60000});report.reloadRestoresQuestion=true;
  await card.getByRole('radio',{name:'B 变窄',exact:true}).check();await card.getByRole('button',{name:'提交并查看解析'}).click();await card.getByRole('alert').waitFor();
  await card.getByRole('button',{name:'提交并查看解析'}).click();await card.getByText('这里还可以继续改进',{exact:false}).waitFor();
  const posted=report.requests.filter(r=>r.path.endsWith('/assessment/answers'));assert.equal(posted[0].key,posted[1].key);report.failedSubmissionRetryKeepsKey=true;report.wrongAnswerFeedback=true;
  await card.getByRole('button',{name:'继续检查当前目标'}).click();await card.getByRole('radio',{name:'A 变宽',exact:true}).check();await card.getByRole('button',{name:'提交并查看解析'}).click();
  await card.getByText('本课理论目标已达标。',{exact:false}).waitFor();report.correctAnswerFeedback=true;
  await card.screenshot({path:dir+'/assessment-feedback.png'});assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(e){report.failure=e.message;console.error(e);await page.screenshot({path:dir+'/assessment-failure.png',fullPage:true});process.exitCode=1;}
 finally{fs.writeFileSync(dir+'/assessment-ui-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();}
})();
