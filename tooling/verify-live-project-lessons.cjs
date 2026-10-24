const {chromium,request,expect}=require('playwright');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),os=require('node:os');
if(process.env.QITU_LIVE_ACCEPTANCE!=='1')throw Error('Set QITU_LIVE_ACCEPTANCE=1 to run persistent synthetic acceptance as the demo student.');
const TARGET=process.env.QITU_E2E_TEMPLATE||'zero8';
if(!['zero8','thunder'].includes(TARGET))throw Error('Only the two current templates are supported.');
const TARGET_URL=process.env.QITU_E2E_WEB||'http://122.51.130.204';
const DIR=process.env.QITU_E2E_DIR||path.join(os.tmpdir(),'qitu-live-'+TARGET);fs.mkdirSync(DIR,{recursive:true});
if(fs.existsSync(DIR+'/flow-result.json'))fs.copyFileSync(DIR+'/flow-result.json',DIR+'/flow-result-'+Date.now()+'.json');
const STUDENT_ID='student-demo';
const key=()=>crypto.randomUUID();
let lastAnswerPost;
const prior=fs.existsSync(DIR+'/flow-result.json')?JSON.parse(fs.readFileSync(DIR+'/flow-result.json','utf8')):{};
const report={startedAt:new Date().toISOString(),environment:'production-synthetic-demo-owner-api',lessons:prior.lessons??[],issues:prior.issues??[],requests:prior.requests??[],modelTurns:prior.modelTurns??[],negative:prior.negative??{},gateChecks:prior.gateChecks??[]};
async function api(client,path,data,method){
 const r=await client.fetch(TARGET_URL+'/api/v1'+path,{method:method||(data?'POST':'GET'),data,headers:{'idempotency-key':key()},timeout:120000});
 const json=await r.json();if(!r.ok())throw Error(r.status()+' '+path+' '+JSON.stringify(json));return json.data??json;
}
async function login(client,role){const options=await api(client,'/auth/test-accounts');const account=options.accounts.find(a=>a.role===role);if(!account)throw Error('Fixture account missing');await api(client,'/auth/login',{...account,deviceId:`live-acceptance-${role}`});}
const save=()=>fs.writeFileSync(DIR+'/flow-result.json',JSON.stringify(report,null,2));
const capturedStreams=new WeakMap(),streamWork=new Set();
async function captureStream(response){
 if(capturedStreams.has(response))return capturedStreams.get(response);
 const scope=report.currentScope;
 const work=(async()=>{
  const text=await response.text();
  const events=text.split(/\r?\n\r?\n/).flatMap(frame=>{try{const type=frame.match(/^event:\s*(.+)$/m)?.[1]?.replace(/^tutor\./,'');const data=frame.match(/^data:\s*(.+)$/m)?.[1];return data?[{...JSON.parse(data),type}]:[];}catch{return []}});
  const turn={projectId:report.projectId,scope,at:new Date().toISOString(),tools:events.filter(e=>e.type==='tool_call'||e.type==='tool_result').map(e=>({name:e.name??events.find(call=>call.type==='tool_call'&&call.callId===e.callId)?.name,callId:e.callId,type:e.type,status:e.status,result:e.result})),errors:events.filter(e=>e.type==='error').map(e=>({code:e.code})),blockKinds:events.filter(e=>e.type==='block').map(e=>e.block?.kind)};
  report.modelTurns.push(turn);save();return {text,events,turn};
 })();capturedStreams.set(response,work);streamWork.add(work);work.finally(()=>streamWork.delete(work)).catch(()=>{});return work;
}
async function clicked(page,locator,suffix){
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(suffix)&&r.request().method()==='POST',{timeout:120000});
 await locator.click({timeout:120000});const r=await pending;const body=await r.json();if(!r.ok())throw Error(r.status()+' '+suffix+' '+JSON.stringify(body));if(suffix==='/assessment/answers')lastAnswerPost={url:r.url(),data:r.request().postDataJSON(),key:r.request().headers()['idempotency-key']};return body.data??body;
}
async function teach(page,client,projectId,message,attempt=0,trigger){
 if(!trigger)await page.getByRole('textbox',{name:'输入你的想法'}).fill(message);
 const pending=page.waitForResponse(r=>r.url().endsWith('/stream')&&r.request().method()==='POST'&&(trigger||r.request().postDataJSON()?.content===message),{timeout:120000});
 await (trigger??page.getByRole('button',{name:'发送想法',exact:true})).click();
 const r=await pending;const {text,events,turn}=await captureStream(r);if(!r.ok())throw Error('Tutor stream '+r.status());
 const failure=events.find(e=>e.type==='error');
 if(failure){
  report.recoveries??=[];report.recoveries.push({kind:'model-retry',code:failure.code,attempt,at:new Date().toISOString()});save();
  if(failure.retryable&&attempt<2)return teach(page,client,projectId,message,attempt+1);
  throw Error('Live model returned error '+failure.code);
 }
 if(!text.includes('model.gateway.complete')){fs.writeFileSync(DIR+'/failed-stream.txt',text);throw Error('Live model gateway was not invoked');}
 if(process.env.QITU_E2E_STRICT_TOOLS==='1'&&turn.tools.some(e=>e.status==='error'))throw Error('TOOL_RETEST_REQUIRED: '+JSON.stringify(turn.tools.filter(e=>e.status==='error')));
 for(const frame of events.filter(e=>e.type==='block'&&e.block?.kind==='board')){
  const title=frame.block.title;
  await (title?page.locator('.qitu-board-card').filter({hasText:title}):page.locator('.qitu-board-card')).last().waitFor({state:'attached',timeout:15000});
 }
 return api(client,'/tutor/session?projectId='+projectId);
}

async function openRecords(page){
 const aside=page.getByRole('complementary',{name:'项目进度与团队智能体'});
 if(!await aside.isVisible())await page.getByRole('button',{name:'项目与进度',exact:true}).click();
 const dock=page.locator('details[aria-label="本课记录与评价"]');await dock.waitFor({timeout:60000});
 if(!await dock.evaluate(el=>el.open))await dock.locator('summary').click();
}
async function recoverReport(page,student,teacher,projectId,lesson){
 const evidence=await api(student,`/learning-plans/${lesson.planId}/sessions/${encodeURIComponent(lesson.learningSessionId)}/evidence?planRevision=${lesson.planRevision}`);
 const submission=evidence.submissions.filter(p=>p.kind==='submitted_artifact').at(-1);if(!submission)return;
 let artifact=await api(student,'/artifacts/'+submission.artifactId);
 if(artifact.reviewStatus!=='approved'){
  const queue=await api(teacher,`/teacher/students/${STUDENT_ID}/reviews?limit=50`);const item=queue.items.find(x=>x.artifactId===artifact.id);
  if(!item)throw Error('Report awaiting review but absent from owner queue');
  await api(teacher,'/teacher/reviews/'+item.reviewId+'/decision',{decision:'approved',comment:'线上合成验收：已核对提交的正文、代码或实验回执及适用条件，保留为测试作品。'});
  artifact=await api(student,'/artifacts/'+submission.artifactId);
 }
 if(artifact.status!=='published'){
  await openRecords(page);
  const panel=page.getByRole('region',{name:'当前课时学习任务'});
  const row=panel.locator('fieldset > div').filter({hasText:/课时作品/}).last();
  await row.getByRole('button',{name:'查看内容与审核状态'}).click({timeout:60000});
  const published=await clicked(page,panel.getByRole('button',{name:'发布已审核的作品'}),'/publish');
  if(published.id!==artifact.id)throw Error('UI published a different artifact');
 }
 await review(teacher,lesson.planId,lesson.learningSessionId);
}

async function review(teacher,planId,sessionId){
 const queue=await api(teacher,`/teacher/students/${STUDENT_ID}/lesson-quality?limit=100`);
 for(const item of queue.items.filter(x=>x.planId===planId&&x.learningSessionId===sessionId)){
  await api(teacher,`/learning-plans/${planId}/sessions/${sessionId}/quality-reviews`,{planRevision:item.planRevision,evidenceRef:item.proof.ref,subjectDigest:item.proof.quality.subjectDigest,
   criteria:item.criteria.map(c=>({criterionId:c.id,meets:true,feedback:'线上合成验收：已核对本课提交内容与测试证据，符合本条标准；该记录仅为自动化验收样本，不代表真实学生能力。'}))});
 }
}


function solveGameQuestion(q){
 const p=q.prompt, options=q.options;
 const rules=[
  [/每一帧.*顺序/,x=>x.body.includes('处理事件、更新状态、绘制')],
  [/持续移动/,x=>x.body.includes('循环中反复更新')],
  [/控制帧率/,x=>x.body.includes('限制更新频率')],
  [/原点.*y/,x=>x.body==='左上角，向下'],
  [/x=100/,x=>x.body==='105'],
  [/屏幕宽 400/,x=>x.body==='360'],
  [/持续按住右键/,x=>x.body.includes('每帧的持续按键状态')],
  [/120.*0.5/,x=>x.body==='60'],
  [/退出窗口事件/,x=>x.body.includes('结束主循环并释放')],
  [/y 方向完全分离/,x=>x.body.includes('两个方向都要有重叠')],
  [/重复加分/,x=>x.body.includes('移除命中的子弹')],
  [/边缘接触/,x=>x.body.includes('边缘接触不算重叠')]
 ];
 const rule=rules.find(([pattern])=>pattern.test(p)), choice=rule&&options.find(rule[1]);
 if(!choice)throw Error('Game public question needs reasoning: '+JSON.stringify(q));
 return choice.body;
}
const gameRoot=process.env.QITU_GAME_SOURCE||path.join(__dirname,'fixtures','thunder-fighter-synthetic');
function ensureGameRun(n){
 if(!gameRoot)throw Error('QITU_GAME_SOURCE must identify the reviewed synthetic artifact directory');
 const output=DIR+'/game-lesson-'+n, level=Math.min(n-3,3), result=output+'/level-'+level+'-result.json';
 if(!fs.existsSync(result)){
  const run=require('node:child_process').spawnSync(process.env.QITU_GAME_PYTHON||'python',[gameRoot+'/verify.py','--level',String(level),'--output',output],{cwd:gameRoot,encoding:'utf8',timeout:120000});
  if(run.status!==0)throw Error('Actual Pygame verification failed: '+run.stdout+run.stderr);
 }
 const receipt=JSON.parse(fs.readFileSync(result,'utf8')), digest=crypto.createHash('sha256').update(fs.readFileSync(gameRoot+'/game.py')).digest('hex');
 if(!receipt.passed||receipt.videoDriver==='dummy'||receipt.sourceSha256!==digest)throw Error('Game run is stale or not a real window');
 report.gameRuns??={};report.gameRuns[n]=receipt;save();
}
function thunderContent(n,kind){
 const texts={
 1:'玩法草图：玩家用方向键或 WASD 控制一架战机，按空格发射子弹；命中一架敌机加10分，碰到敌机或漏过敌机损失一条生命，共3条。生命耗尽显示失败，按R重新开始。最小目标先做到窗口能退出、战机能移动，之后才逐步启用子弹与敌机。这是原创几何图形素材的合成验收游戏。',
 2:'每一帧按处理事件、更新状态、绘制刷新三个步骤重复。位置变量x、y表示左上角，x向右增加、y向下增加。例：x从100向右5像素变成105。400像素宽的窗口放40像素战机时x上限是360。位置要保存为浮点数，用速度乘实际时间步长更新后再转换为绘制坐标；时钟限制帧率。',
 3:'单次KEYDOWN与持续按住状态不同。按下加入按键集合，每帧按速度乘dt移动，松开移除。120像素/秒乘0.5秒等于60像素。两个矩形必须横纵方向都有重叠才碰撞，只接触边缘不算。命中时移除子弹和敌机，避免下帧重复加分。收到退出事件结束循环并清理资源。',
 4:'本课运行第1级，只启用窗口、退出、按键移动和边界。实际Pygame窗口接收事件队列输入，按右键移动30帧后横坐标增加，松开后停止，长按左键被限制在x=0；关闭窗口结束循环。输入、时间步长、浮点位置与画面更新相对应。',
 5:'本课启用第2级：按空格发射子弹，子弹向上，定时生成的敌机向下。对象离开窗口后从列表清除。实际运行验证了发射、下降和清理。更新迭代时构造剩余对象列表，避免遍历过程中漏处理。此级先检查对象运动，再启用完整得分规则。',
 6:'本课第3级完整状态机：命中加10分并移除对象；碰撞或漏过减生命；生命归零冻结更新并显示GAME OVER；R调用reset清零分数、恢复3条生命、清空对象和按键。真实窗口运行验证命中只加一次、3次碰撞失败和R重开，仍可正常退出。',
 7:'交付可玩小游戏。环境：Windows、Python 3.13、Pygame 2.6.1。启动：python game.py，方向键或WASD移动，空格发射，R在失败后重开，Esc退出。几何图形为本作品自绘。实机自动试玩通过Pygame事件队列输入，并实际绘制窗口、命中加分、受伤失败和重开；不是静态语法检查，也不声明生产容器runner已上线。调试修订：用浮点位置保存速度×dt，避免逐帧整数截断；用移除命中对象避免重复计分。代码、源码摘要与运行记录如下，可依照命令复核。',
 8:'我现在能把玩法分解为输入、状态更新与绘制。以命中代码为例：先用Rect判断两方向重叠，再移除命中子弹与敌机并只加10分；运行回执验证下一段帧数不再重复加分。修订了浮点位移、边界限制及重开时清空状态的问题。已审核发布的第7课源码与实际窗口运行记录可复核。后续增加难度时应先写可观察的规则，再比较修改前后实际玩法，不把静态检查称作可玩。'
 };
 const receipt=report.gameRuns?.[n];
 const code=n===7&&kind==='reflect'? '\n完整源码 game.py：\n'+fs.readFileSync(gameRoot+'/game.py','utf8'):'';
 return `【线上合成自动化验收，非真实学生能力记录】第${n}课，${kind}。\n${texts[n]}${receipt?'\n实际运行回执：'+JSON.stringify(receipt):''}${code}`;
}

function solvePublicQuestion(question){
 const prompt=question.prompt; const choices=question.options??[];
 let correct;
 if(TARGET==='thunder')return solveGameQuestion(question);
 if(/(?:波幅|波动).*?(?:都是|都为)/.test(prompt)){
  const amplitude=Number(prompt.match(/(?:波幅|波动).*?(?:都是|都为)\s*(\d+)/)?.[1]);
  const total=prompt.includes('方向相反')?0:amplitude*2;
  correct=choices.find(x=>Number(x.body.match(/合成波[幅动]为\s*(\d+)/)?.[1])===total);
 }else if(prompt.includes('稳定的明暗条纹'))correct=choices.find(x=>x.body==='两列波保持稳定的相位差');
 else if(/缝.*距/.test(prompt)&&prompt.includes('d'))correct=choices.find(x=>x.body.startsWith('只改变 d'));
 if(!correct)throw Error('Public question needs reasoning: '+JSON.stringify(question));
 return correct.body;
}
function lessonContent(n,kind){
 if(TARGET==='thunder')return thunderContent(n,kind);
 const entries={
  1:'我想解释一束光经过狭窄开口后为什么会出现明暗条纹。我现在还不懂波和相位，先比较单缝与双缝的示意图，不直接照射真实激光。亮暗不是光被染成黑白，后续要用叠加模型说明。我的探究问题是：保持波长和屏距不变，缝的结构如何影响亮暗分布？',
  2:'波动用带方向的示意量表示。同方向的两个单位波动相加得到两个单位，反方向抵消成零；这不是把光强直接相加。稳定条纹要求相位关系稳定，本课使用同频、同偏振的相干模型。公平比较一次只改缝距，保持波长、缝宽与屏距不变，并保存参数与观察。',
  3:'双缝出射波到屏幕不同位置存在光程差。同相到达相长形成亮纹，反相到达相消形成暗纹。中央方向光程差为零。有限宽双缝还受单缝包络约束，模拟读数不是实测，不能只凭好看的图片判断模型成立。',
  4:'远场小角度条件下条纹间距约为 λD/d。保持 D、d 与缝宽不变，波长减小时条纹间距减小。若改变 d，必须保持其余量相同；比较记录中保留两组实际参数。下次要进一步比较 d 加倍后的间距，并核对单位。',
  5:'单缝内不同位置的次级波相互叠加，形成中央宽亮带和两侧较弱亮纹。单缝第一暗纹满足 a sinθ=λ，中央包络角宽约 2λ/a。单缝衍射与双缝等距细条纹不能混为一谈；当前仅是远场模型观察。',
  6:'固定波长与屏距，缝变窄时中央亮带变宽，第一暗纹离中心更远；固定缝宽时波长缩短则亮带变窄。本次保留两组受控参数与观察，明确改变的是哪个变量。比较仅支持批准参数域内的远场模型，未进行真实测量。',
  7:'合成验收探究报告。问题：双缝细条纹与单缝包络有什么联系？主张：有限宽双缝强度包含单缝衍射包络和双缝干涉调制。证据：本项目已保存的第3至7课注册实验观察，参数、模型版本与观察回执可追溯；波长缩短时细纹间距和包络角宽一起减小。理由：远场下干涉间距约 λD/d，单缝第一暗纹约 λ/a。限制：单色相干、同偏振、远场、有限孔径，模拟观察不可标成实测。修订：把原先“只有双缝才有明暗”改为单缝也能产生衍射亮暗分布。下一步由同学按相同参数复核，改变 d 时只比较细纹间距。',
  8:'我最初以为明暗是遮挡造成，现在能用相长、相消和单缝包络区分两种结构。依据是本项目已保存的参数与模拟观察，最终报告经审核并发布。我曾混淆光强和波动示意量，已修订为波先按相位叠加再求强度。迁移问题：改用更短波长时，先预测条纹与包络都缩窄，再以受控参数检验。局限：未进行真实激光实验，不把模型观察标为实测。'
 };
 return `【线上合成自动化验收，非真实学生能力记录】第${n}课，${kind}。\n${entries[n]}`;
}
async function clickedRefresh(page,panel){
 const pending=page.waitForResponse(r=>r.url().endsWith('/progress')&&r.request().method()==='GET',{timeout:30000});
 await panel.getByRole('button',{name:'刷新课时与评价',exact:true}).click(); await(await pending).finished();
}

(async()=>{
 const browser=await chromium.launch({headless:false});
 const context=await browser.newContext({viewport:{width:1760,height:1100}});const page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',e=>report.issues.push({kind:'pageerror',message:e.message}));
 page.on('response',r=>{if(r.url().includes('/api/v1/')&&r.request().method()!=='GET')report.requests.push({path:new URL(r.url()).pathname,status:r.status(),method:r.request().method()});if(r.url().endsWith('/stream')&&r.request().method()==='POST')void captureStream(r).catch(e=>report.issues.push({kind:'stream-capture',message:e.message}));});
 const teacher=await request.newContext();
 try{
  await login(context.request,'student');const identity=await api(context.request,'/auth/me');if((identity.user?.id??identity.id)!=='student-demo')throw Error('This harness only supports the synthetic demo student');await login(teacher,'teacher');
  const projectFile=DIR+'/'+(TARGET==='optics16'?'project-url':TARGET+'-project-url')+'.txt';
  if(!fs.existsSync(projectFile)){
   await page.goto(TARGET_URL+'/student/inspiration',{waitUntil:'domcontentloaded'});
   const title=TARGET==='zero8'?'光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始':TARGET==='thunder'?'雷霆战机':TARGET==='optics16'?'光学探究：从光路模型到衍射与散射证据':'光为什么会出现明暗条纹？干涉与衍射探究';
   await page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'💬 与AI搭档开始'}).click();
   await page.waitForURL('**/student/tutor/**',{timeout:90000});fs.writeFileSync(projectFile,page.url());
  }
  const saved=fs.readFileSync(projectFile,'utf8').trim();const projectId=saved.split('/').pop();report.target=TARGET;report.projectId=projectId;
  await page.goto(TARGET_URL+new URL(saved).pathname,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'发送想法',exact:true}).waitFor({timeout:120000});
  const learned=new Set();
  let checkedTurns=prior.modelTurns?.length??0;
  for(let iteration=0;iteration<200;iteration++){
   await page.waitForFunction(button=>!button.textContent.includes('发送中'),await page.locator('.qitu-composer-submit').elementHandle(),{timeout:120000});
   await Promise.allSettled([...streamWork]);
   const newFailures=report.modelTurns.slice(checkedTurns).flatMap(turn=>turn.tools.filter(event=>event.status==='error'));
   checkedTurns=report.modelTurns.length;
   if(process.env.QITU_E2E_STRICT_TOOLS==='1'&&newFailures.length)throw Error('OPENING_OR_PREVIOUS_TOOL_RETEST_REQUIRED: '+JSON.stringify(newFailures));
   const current=await api(context.request,'/tutor/project-context?projectId='+projectId);
   fs.writeFileSync(DIR+'/context.json',JSON.stringify(current,null,2));
   const lesson=current.lesson,planId=lesson.planId,sid=lesson.learningSessionId;
   if(lesson.lessonIndex===7)await recoverReport(page,context.request,teacher,projectId,lesson);
   const progress=await api(context.request,'/learning-plans/'+planId+'/progress');
   fs.writeFileSync(DIR+'/progress.json',JSON.stringify(progress,null,2));
   if(progress.completedCount===progress.totalCount){if(current.project.stage!=='completed')throw Error('All lessons finished but project not archived: '+current.project.stage);report.completed={projectId,...progress,stage:current.project.stage};break;}
   if(lesson.lessonIndex>Number(process.env.QITU_E2E_MAX_LESSON||16))break;
   const item=progress.sessions.find(x=>x.sessionId===progress.currentSessionId),activity=item.activities.find(x=>x.status==='current');
   report.currentScope={lesson:item.lessonIndex,learningSessionId:sid,activityId:activity?.activityId,kind:activity?.kind};
   if(TARGET==='thunder'&&item.lessonIndex>=4)ensureGameRun(item.lessonIndex);
   const event={lesson:item.lessonIndex,title:item.title,activity:activity?.kind??'complete',evidence:activity?.evidence,at:new Date().toISOString()};
   console.log(JSON.stringify(event));report.lessons.push(event);save();
   await page.getByRole('button',{name:'发送想法',exact:true}).waitFor({timeout:120000});
   const sidebar=page.getByRole('complementary',{name:'项目进度与团队智能体'}); if(!await sidebar.isVisible())await page.getByRole('button',{name:'项目与进度',exact:true}).click();
   const dock=page.locator('details[aria-label="本课记录与评价"]');if(await dock.count()&&!(await dock.evaluate(el=>el.open)))await dock.locator('summary').click();
   const panel=page.getByRole('region',{name:'当前课时学习任务'});
   if(!activity){
    await clickedRefresh(page,panel);
    for(const checkbox of await panel.getByRole('checkbox').all())await checkbox.check();
    await clicked(page,panel.getByRole('button',{name:'提交证据并申请完成本课'}),'/complete');
    if(item.lessonIndex===(TARGET==='zero8'?2:3)){
     const synced=await api(context.request,'/tutor/project-context?projectId='+projectId);
     if(synced.project.stage!=='practice_building')throw Error('Completion did not synchronize practice: '+synced.project.stage);
     report.gateChecks.push({trigger:'lesson-completion',lesson:item.lessonIndex,stage:synced.project.stage});
    }
    if((await api(context.request,'/learning-plans/'+planId+'/progress')).completedCount<=progress.completedCount)throw Error('Completion receipt did not persist');
    await page.screenshot({path:DIR+`/${TARGET}-lesson-${item.lessonIndex}-complete.png`,fullPage:true});
   }else if(activity.evidence==='session_response'||activity.evidence==='submitted_artifact'){
    if(activity.kind==='theory'&&!learned.has(sid)){
     await teach(page,context.request,projectId,'我从零开始，请按本课冻结目标解释当前概念，用一个分步图示和例子，先教再检查；若没有授权编程知识库，请明确这是教学示例，不要声称已经检索教材。');learned.add(sid);
    }
    if(activity.evidence==='submitted_artifact'){
     await panel.getByLabel('记录类型').selectOption('artifacts');
     await panel.getByLabel('作品标题',{exact:true}).fill('线上合成验收作品：'+item.title);
    }
    const textbox=panel.getByRole('textbox').last();
    await textbox.fill(lessonContent(item.lessonIndex,activity.kind));
    const contextRefresh=process.env.QITU_E2E_VERIFY_REFRESH==='1'?page.waitForResponse(r=>r.url().includes('/tutor/project-context?')&&r.status()===200,{timeout:20000}):null;
    const submitted=await clicked(page,panel.getByRole('button',{name:'保存学习记录',exact:true}),activity.evidence==='submitted_artifact'?'/artifacts':item.lessonIndex===progress.totalCount&&activity.kind==='reflect'?'/reflections':'/responses');
    if(contextRefresh)await (await contextRefresh).finished();
    if(activity.evidence==='submitted_artifact'){
     const queue=await api(teacher,`/teacher/students/${STUDENT_ID}/reviews?limit=50`);const reviewItem=queue.items.find(x=>x.artifactId===submitted.artifact.id);if(!reviewItem)throw Error('Submitted artifact absent from teacher queue');
     await api(teacher,'/teacher/reviews/'+reviewItem.reviewId+'/decision',{decision:'approved',comment:'线上合成验收审核：已核对本课作品正文、模型观察和适用条件；作为测试样本保留。'});
     await page.reload({waitUntil:'domcontentloaded'});
     await openRecords(page);await page.getByRole('button',{name:'查看内容与审核状态'}).last().click();
     await clicked(page,page.getByRole('button',{name:'发布已审核的作品'}),'/publish');
    }
    await review(teacher,planId,sid);
    if(process.env.QITU_E2E_VERIFY_REFRESH==='1'){
     await panel.getByRole('button',{name:'刷新课时与评价',exact:true}).click();
     const fresh=await api(context.request,'/tutor/project-context?projectId='+projectId);
     if(fresh.lesson?.assessmentAvailable){
      try{await page.getByRole('region',{name:'本课目标考核'}).waitFor({timeout:10000});}
      catch{throw Error('REFRESH_PARENT_SCOPE_STALE: server enabled assessment but refresh did not mount the card');}
     }
    }
   }else if(activity.evidence==='mastery'){
    const card=page.getByRole('region',{name:'本课目标考核'});
    const start=card.getByRole('button',{name:/开始检查本课理解|继续检查当前目标/});
    await card.waitFor({timeout:30000});
    const view=TARGET==='zero8'?await api(context.request,`/tutor/projects/${projectId}/lesson/assessment`,{planId,planRevision:lesson.planRevision,learningSessionId:sid}):await clicked(page,start,'/assessment');
    if(TARGET==='zero8')await card.getByRole('button',{name:'提交并查看解析'}).waitFor({timeout:30000});
    const question=view.nextStep?.question;if(!question)throw Error('Missing official question '+JSON.stringify(view));
    const reasonedAnswer=solvePublicQuestion(question);
    fs.writeFileSync(DIR+'/last-question.json',JSON.stringify({question,reason:'Solved from public question and options'},null,2));
    const negative=process.env.QITU_E2E_NEGATIVE==='1';report.negative??={};
    if(negative&&!report.negative.pendingReload){
     await page.reload({waitUntil:'domcontentloaded'});const restored=await api(context.request,'/tutor/projects/'+projectId+'/lesson/assessment',{planId,planRevision:lesson.planRevision,learningSessionId:sid});
     if(restored.nextStep?.question?.questionId!==question.questionId)throw Error('Reload replaced pending question');
     if(TARGET!=='zero8')await clicked(page,start,'/assessment');
     report.negative.pendingReload=true;
    }
    const wrong=negative&&!report.negative.wrongAnswer;
    if(question.options.length){const correct=question.options.find(x=>x.body===reasonedAnswer||x.id===reasonedAnswer);const option=wrong?question.options.find(x=>x.id!==correct?.id):correct;if(!option)throw Error('Expected response missing from public options');await card.locator('input[type=radio][value='+JSON.stringify(option.id)+']').check({timeout:120000});}
    else await card.getByRole('textbox').fill(wrong?'我还不知道，需要再学习。':reasonedAnswer);
    const accepted=await clicked(page,card.getByRole('button',{name:'提交并查看解析'}),'/assessment/answers');
    if(wrong){if(accepted.answer.isCorrect)throw Error('Incorrect response was accepted');report.negative.wrongAnswer=true;}
    else if(!accepted.answer.isCorrect)throw Error('Publicly reasoned answer rejected');
    if(accepted.answer.theoryMastered){
     const synced=await api(context.request,'/tutor/project-context?projectId='+projectId);
     const expected=TARGET==='thunder'&&lesson.lessonIndex===2?'theory_learning':'practice_ready';
     if(synced.project.stage!==expected)throw Error('Formal theory answer did not synchronize readiness: '+synced.project.stage+' expected '+expected);
     if(synced.lesson.learningSessionId!==sid)throw Error('Theory readiness incorrectly skipped the current lesson');
     report.gateChecks.push({trigger:'formal-answer',lesson:lesson.lessonIndex,stage:synced.project.stage,currentLessonPreserved:true});
    }
    if(negative&&!wrong&&!report.negative.answerReplay){
     const replay=await context.request.post(lastAnswerPost.url,{data:lastAnswerPost.data,headers:{'idempotency-key':lastAnswerPost.key}});
     const data=await replay.json();if(!replay.ok())throw Error('Answer replay HTTP '+replay.status());require('node:assert/strict').deepEqual(data.data.answer,{...accepted.answer,replayed:true},'Answer replay changed the grading receipt');
     report.negative.answerReplay=true;
    }
   }else if(activity.evidence==='experiment_observation'){
    let chat=await api(context.request,'/tutor/session?projectId='+projectId);
    const matching=()=>chat.turns.flatMap(t=>t.blocks).filter(b=>b.kind==='optics_experiment'&&b.scope?.learningSessionId===sid&&b.scope?.planRevision===lesson.planRevision&&(b.specVersion==='1.0.0'||b.scope?.activityId===activity.activityId)).at(-1);
    for(let tries=0;!matching()&&tries<3;tries++)chat=await teach(page,context.request,projectId,'我准备开始本课当前的模拟探究。请调用已授权教学活动工具，展示本课已注册的实验卡片，让我先预测，再运行并保存观察。不要替我操作或提交学习证据。');
    const block=matching();if(!block)throw Error('No owner-issued experiment after three teaching requests');
    await page.reload({waitUntil:'domcontentloaded'});
    if(block.specVersion==='2.0.0'){
     const lab=page.getByRole('region',{name:block.initialMode==='interference'?'双缝干涉探究':'单缝衍射探究'}).last();
     await lab.waitFor({timeout:30000});
     if(await lab.getByRole('button',{name:'保存预测',exact:true}).count()){
      await lab.getByLabel('先写下你的预测').fill('保持几何尺寸和屏距不变，减小波长，预测中央亮带和干涉条纹的间距变小。');
      await clicked(page,lab.getByRole('button',{name:'保存预测',exact:true}),'/action');
     }
     const samples=[4,6].includes(item.lessonIndex)?2:1;
     for(let sample=0;sample<samples;sample++){
      await page.waitForFunction(el=>el.getAttribute('aria-busy')==='false',await lab.elementHandle());
      if(sample){const slider=lab.getByRole('slider',{name:'波长 λ',exact:true});const target=(await slider.inputValue())==='450'?650:450;await slider.focus();await slider.press('Home');for(let value=400;value<target;value+=10)await slider.press('ArrowRight');if(Number(await slider.inputValue())!==target)throw Error('Comparison parameter did not update');}
      await clicked(page,lab.getByRole('button',{name:/^(再次)?运行并比较$/}),'/action');
      const parameters=await lab.getByRole('slider').evaluateAll(inputs=>inputs.map(input=>({parameter:input.getAttribute('aria-label'),value:input.value})));
      await lab.getByLabel('我的观察与解释').fill('线上合成模拟观察。当前实际参数：'+JSON.stringify(parameters)+'。本次记录当前一组模型结果；需要结合本课另一条实际回执才能比较变化方向。这是远场单色模型，不是真实测量，不能比较绝对亮度。');
      await clicked(page,lab.getByRole('button',{name:'保存这次观察',exact:true}),'/action');
     }
    }else{
     await page.getByLabel('我的观察（模拟）').last().waitFor({timeout:30000});
     const predict=page.getByRole('button',{name:'确认预测并解锁仿真',exact:true}).last();
     if(await predict.count()){
      await page.locator('input[name=prediction-option]').nth((await page.locator('input[name=prediction-option]').count())-3).check();await clicked(page,predict,'/action');
     }
     await clicked(page,page.getByRole('button',{name:/^(运行仿真|再次运行仿真|仿真已运行)$/}).last(),'/action');
     await page.getByLabel('我的观察（模拟）').last().fill('线上合成模拟观察：一次改变一个变量，比较图形与读数。衍射中央亮带与缝宽成反比；瑞利域内短波散射较强，单色光不自动变白。这是模拟观察，不是真实测量。');
     await clicked(page,page.getByRole('button',{name:'记录观察',exact:true}).last(),'/action');
    }
    await review(teacher,planId,sid);
   }else if(activity.evidence==='teaching_delivery'){
    let view=await api(context.request,`/tutor/projects/${projectId}/lesson/courseware`);
    const currentInstance=()=>view?.instances.find(x=>x.activityId===activity.activityId&&!x.acknowledgedAt);
    for(let tries=0;!currentInstance()&&tries<3;tries++){
     const nextConcept=page.getByRole('button',{name:'继续学习下一个概念',exact:true});
     if(view.instances.some(x=>x.activityId===activity.activityId&&x.acknowledgedAt))await page.getByRole('region',{name:'本课课件',exact:true}).getByRole('heading',{level:4}).waitFor({timeout:30000});
     await teach(page,context.request,projectId,'我还没有学过这些概念。请先检索并读取本课授权知识库，再调用教学活动工具展示与当前目标对应的分步课件。解释术语、符号和例子，等我看完再继续检查。',0,await nextConcept.isVisible()?nextConcept:undefined);
     view=await api(context.request,`/tutor/projects/${projectId}/lesson/courseware`);
    }
    if(!currentInstance())throw Error('No persisted current courseware after three grounded teaching requests '+JSON.stringify(view));
    await page.reload({waitUntil:'domcontentloaded'});
    const card=page.getByRole('region',{name:'本课课件',exact:true});
    await card.getByRole('heading',{level:4}).waitFor({timeout:30000});
    for(let step=0;step<12&&await card.getByRole('button',{name:'下一步',exact:true}).count();step++)await clicked(page,card.getByRole('button',{name:'下一步',exact:true}),'/position');
    await clicked(page,card.getByRole('button',{name:'看完了，继续学习',exact:true}),'/position');
   }else throw Error('Unknown browser activity '+activity.evidence);
   event.passed=true;save();
   await page.reload({waitUntil:'domcontentloaded'});
  }
 }catch(e){report.issues.push({kind:'failure',message:e.message});console.error(e);fs.writeFileSync(DIR+'/failure.txt',await page.locator('body').innerText());await page.screenshot({path:DIR+'/failure.png',fullPage:true});process.exitCode=1;}
 finally{await Promise.allSettled([...streamWork]);report.finishedAt=new Date().toISOString();fs.writeFileSync(DIR+'/flow-result.json',JSON.stringify(report,null,2));await teacher.dispose();await browser.close();}
})();
