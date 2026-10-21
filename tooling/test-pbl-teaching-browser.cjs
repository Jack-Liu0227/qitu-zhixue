const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const TARGET_URL=process.env.TARGET_URL || 'http://127.0.0.1:3205';
assert.equal(new URL(TARGET_URL).hostname,'127.0.0.1');
const scope={projectId:'project',planId:'plan',planRevision:1,learningSessionId:'session',objectiveIds:['objective']};
const criterion={id:'criterion',description:'区分观察与解释，并引用观测证据。'};
let quality={status:'pending',subjectDigest:'a'.repeat(64),feedback:[]};
const proof=()=>({kind:'session_response',ref:'task_submission:proof',sourceKind:'task_submission',objectiveId:'objective',artifactId:'artifact',artifactVersionId:'version',scope,quality});
const artifact={id:'artifact',projectId:'project',title:'课堂表达',status:'draft',reviewStatus:'none',latestVersion:{id:'version',inlineText:'我记录到光路发生改变，解释仍需证据支持。'}};
let queueVisible=true;
let denyTeacher=false;
let failQualityOnce=true;
const reviewKeys=[];
let preferenceVersion=0;
let selected='project-1';
let collected=false;
let failPreferenceOnce=true;
const preferenceKeys=[];
const appliedKeys=new Set();
const requests=[];
const checks=[];
let delaySearch=false;
let slowStarted;
const slowRequest=new Promise(resolve=>{slowStarted=resolve;});
const historyItem=n=>({id:`project-${n}`,kind:'project',title:`光学项目 ${n}`,subtitle:'真实任务探究',tags:[],status:'theory_learning',
  templateVersionId:'v4',currentStageIndex:2,stageTotal:10,progressPercent:20,createdAt:'2026-10-01T00:00:00Z',lastLearningActivityAt:null,
  collectedAt:n===1&&collected?'2026-10-21T00:00:00Z':null,isCurrent:selected===`project-${n}`});

(async()=>{
 const browser=await chromium.launch({headless:false});
 let debugContext;
 try {
  const context=await browser.newContext();
  debugContext=context;
  const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/api/v1/**',async route=>{
   const request=route.request();const url=new URL(request.url());const path=url.pathname;
   requests.push({path,query:url.search,method:request.method()});
   const reply=(data,status=200)=>route.fulfill({status,json:{data}});
   if(path==='/api/v1/projects/query'){
    let items=Array.from({length:25},(_,i)=>historyItem(i+1));
    if(url.searchParams.get('includeCollected')!=='true')items=items.filter(item=>!item.collectedAt);
    const q=url.searchParams.get('q')||'';items=items.filter(item=>item.title.includes(q));
    if(delaySearch && q==='光学项目 24'){slowStarted();await new Promise(resolve=>setTimeout(resolve,1200));}
    if(url.searchParams.get('tab')!=='active')items=[];
    const offset=url.searchParams.get('cursor')==='page-2'?20:0;
    return reply({items:items.slice(offset,offset+20),nextCursor:items.length>offset+20?'page-2':null,counts:{active:items.length,draft:0,done:0},
      revision:String(preferenceVersion),preferenceVersion,currentProjectId:selected,selectionSource:selected?'explicit':'none'});
   }
   if(path.endsWith('/display-preference')||path.endsWith('/current-selection')){
    const key=request.headers()['idempotency-key'];preferenceKeys.push(key);assert.ok(key);
    const body=request.postDataJSON();
    if(!appliedKeys.has(key)){assert.equal(body.expectedVersion,preferenceVersion);if('collected' in body)collected=body.collected;if('currentProjectId'in body)selected=body.currentProjectId;preferenceVersion++;appliedKeys.add(key);}
    if(failPreferenceOnce){failPreferenceOnce=false;return route.abort('failed');}
    return reply({version:preferenceVersion,currentVersion:preferenceVersion,currentProjectId:selected,collectedAt:collected?'2026-10-21T00:00:00Z':null,superseded:false,replayed:preferenceKeys.length>1});
   }
   if(path.endsWith('/next-step'))return reply(null);
   if(path==='/api/v1/teacher/students/student/lesson-quality'){
    if(denyTeacher)return route.fulfill({status:403,json:{message:'Forbidden'}});
    return reply({items:queueVisible?[{planId:'plan',projectId:'project',planRevision:1,learningSessionId:'session',lessonTitle:'光学观察',proof:proof(),criteria:[criterion],content:artifact.latestVersion.inlineText}]:[],hasMore:false,unavailablePlans:0});
   }
   if(path.endsWith('/quality-reviews')){
    const body=request.postDataJSON();assert.equal(body.subjectDigest,quality.subjectDigest);assert.equal(body.criteria.length,1);
    reviewKeys.push(request.headers()['idempotency-key']);
    quality={status:body.criteria.every(item=>item.meets)?'accepted':'needs_revision',subjectDigest:quality.subjectDigest,feedback:body.criteria};queueVisible=false;
    if(failQualityOnce){failQualityOnce=false;return route.abort('failed');}
    return reply({quality,replayed:reviewKeys.length>1});
   }
   if(path==='/api/v1/learning-plans/plan/progress')return reply({planId:'plan',projectId:'project',planRevision:1,currentSessionId:'session',completedCount:0,totalCount:1,contractReady:true,
    sessions:[{sessionId:'session',lessonIndex:1,title:'光学观察',status:'current',completedAt:null,canComplete:quality.status==='accepted',blockers:quality.status==='accepted'?[]:['LESSON_QUALITY_REQUIRED']}]});
   if(path.endsWith('/sessions/session/evidence'))return reply({scope,sessionType:'theory',allowedActions:['respond'],submissions:[proof()],observations:[],approvedArtifacts:[],reflections:[],qualityCriteria:[criterion]});
   if(path.endsWith('/sessions/session/responses'))return reply({proof:proof(),artifact,assessmentStatus:'assessment_required',masteryUpdated:false,replayed:false});
   return route.fulfill({status:500,json:{message:`Unexpected fixture request ${path}`}});
  });
  const teacher=await context.newPage();await teacher.goto(TARGET_URL+'/teacher');
  await teacher.getByText('光学观察 · 待评价产物').click();
  const send=teacher.getByRole('button',{name:'提交质量评价',exact:true});
  assert.equal(await send.isDisabled(),true);
  await teacher.getByLabel('我已阅读上方待评价版本').check();
  await teacher.getByLabel('反馈：'+criterion.description).fill('请把观察事实和解释分开，并补充观测证据。');
  assert.equal(await send.isDisabled(),true);
  await teacher.getByLabel('质量判断：'+criterion.description).selectOption('false');
  await send.click();await teacher.getByRole('alert').waitFor();assert.equal(queueVisible,false);
  await send.click();await teacher.getByText('暂无待评价的课内产物。').waitFor();
  assert.equal(reviewKeys.length,2);assert.equal(reviewKeys[0],reviewKeys[1]);checks.push('teacher-explicit-criteria-and-lost-response-retry');

  const student=await context.newPage();await student.goto(TARGET_URL+'/lesson');
  await student.getByRole('status').filter({hasText:'需要修改后重新提交'}).waitFor();
  await student.getByText('请把观察事实和解释分开，并补充观测证据。',{exact:true}).waitFor();
  const complete=student.getByRole('button',{name:'提交证据并申请完成本课',exact:true});
  assert.equal(await complete.isDisabled(),true);
  await student.getByLabel('我的回答、观察与理由').fill('我先记录观察，再提出解释，并说明还缺少哪些证据。');
  await student.getByRole('button',{name:'保存学习记录',exact:true}).click();
  await student.getByText('学习内容已保存，后续评价以服务端审核为准。').waitFor();
  assert.equal(await complete.isDisabled(),true);checks.push('student-revision-feedback-and-no-automatic-completion');
  quality={status:'pending',subjectDigest:'b'.repeat(64),feedback:[]};queueVisible=true;
  await teacher.getByRole('button',{name:'刷新课内评价',exact:true}).click();
  await teacher.getByText('光学观察 · 待评价产物').click();
  await teacher.getByLabel('我已阅读上方待评价版本').check();
  await teacher.getByLabel('质量判断：'+criterion.description).selectOption('true');
  await teacher.getByRole('button',{name:'提交质量评价',exact:true}).click();
  await teacher.getByText('暂无待评价的课内产物。').waitFor();
  await student.getByRole('button',{name:'刷新课时与评价',exact:true}).click();
  await student.getByText('本版本质量已达标',{exact:true}).waitFor();
  await student.getByRole('checkbox',{name:'课时表达 1',exact:true}).check();assert.equal(await complete.isEnabled(),true);
  checks.push('owner-approval-refreshes-evidence-and-completion-conditions');
  denyTeacher=true;await teacher.getByRole('button',{name:'刷新课内评价',exact:true}).click();
  await teacher.getByText('无权查看该学生的课内产物。').waitFor();
  assert.equal(await teacher.getByText(artifact.latestVersion.inlineText,{exact:true}).count(),0);checks.push('teacher-permission-failure-clears-content');

  const history=await context.newPage();await history.goto(TARGET_URL+'/projects');
  await history.getByText('进行中 25 · 草稿 0 · 已完成 0').waitFor();
  assert.equal(await history.locator('.qitu-project-card').count(),20);
  await history.getByRole('button',{name:'下一页',exact:true}).click();await history.getByText('第 2 页',{exact:true}).waitFor();
  await history.waitForFunction(()=>document.querySelectorAll('.qitu-project-card').length===5);
  assert.equal(await history.locator('.qitu-project-card').count(),5);
  await history.getByRole('button',{name:'上一页',exact:true}).click();
  await history.waitForFunction(()=>document.querySelectorAll('.qitu-project-card').length===20);
  await history.getByRole('button',{name:'收纳并清空当前选择',exact:true}).click();
  await history.getByRole('status').filter({hasText:'Network unavailable'}).waitFor();
  assert.equal(await history.locator('.qitu-project-card').count(),20);
  await history.getByRole('button',{name:'收纳并清空当前选择',exact:true}).click();
  await history.getByText('显示偏好已保存。',{exact:true}).waitFor();
  assert.equal(preferenceKeys[0],preferenceKeys[1]);
  assert.equal(await history.getByRole('button',{name:'收纳并清空当前选择',exact:true}).count(),0);
  await history.getByLabel('包含已收纳').check();
  await history.getByRole('button',{name:'恢复显示',exact:true}).click();
  await history.getByText('显示偏好已保存。',{exact:true}).waitFor();
  assert.equal(collected,false);checks.push('bounded-history-pages-collect-retry-and-restore');
  await history.getByRole('searchbox').fill('光学项目 25');await history.locator('.qitu-project-card-title').filter({hasText:'光学项目 25'}).waitFor();
  assert.equal(await history.locator('.qitu-project-card').count(),1);
  assert.ok(requests.some(item=>item.path==='/api/v1/projects/query'&&item.query.includes('q=')));
  assert.ok(!requests.some(item=>item.path==='/api/v1/projects'));checks.push('server-search-without-full-history-request');
  delaySearch=true;
  await history.getByRole('searchbox').fill('光学项目 24');await slowRequest;
  await history.getByRole('searchbox').fill('光学项目 25');
  await history.getByText('进行中 1 · 草稿 0 · 已完成 0',{exact:true}).waitFor();
  await history.waitForTimeout(1500);
  assert.equal(await history.locator('.qitu-project-card-title').innerText(),'光学项目 25');
  checks.push('older-search-response-cannot-overwrite-current-query');
  assert.deepEqual(errors,[]);
  const report={schemaVersion:1,target:TARGET_URL,mode:'component fixture with intercepted API responses',realModelCalls:0,checks,errors,success:true};
  if(process.env.QITU_BROWSER_REPORT)fs.writeFileSync(process.env.QITU_BROWSER_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
 } catch(error){
  if(debugContext)for(const page of debugContext.pages())console.error(JSON.stringify({url:page.url(),text:(await page.locator('body').innerText()).slice(0,1800)}));
  console.error(JSON.stringify({lastRequests:requests.slice(-12)}));throw error;
 } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
