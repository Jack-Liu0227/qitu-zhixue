import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Disposable data only. This command refuses the normal application database.
const require = createRequire(new URL('../packages/database/package.json', import.meta.url));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const database = (await client.query('select current_database() as name')).rows[0].name;
  if (!/^qitu_family_preview_[0-9]{8}$/.test(database)) throw new Error('A separate disposable family preview database is required');
  for (const name of ['demo-identities', 'tutor-workspace', 'domain-foundation']) {
    await client.query(readFileSync(new URL(`../database/seeds/${name}.sql`, import.meta.url), 'utf8'));
  }
  const names = ['林沐辰', '陈以安', '周知夏', '许星禾'];
  const students = ['student-demo', 'student-demo-2', 'student-demo-3', 'student-demo-4'];
  for (const [index, id] of students.entries()) await client.query('update users set display_name=$1 where id=$2', [names[index], id]);
  for (const [id, name] of [['parent-demo', '林女士'], ['parent-demo-2', '陈先生'], ['teacher-demo', '李老师'], ['teacher-demo-2', '王老师'], ['admin-demo', '教务管理']]) {
    await client.query('update users set display_name=$1 where id=$2', [name, id]);
  }
  await client.query("update schools set name='知行学园' where id='school-demo'");
  for (const role of ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN']) {
    const password = process.env[`QITU_TEST_LOGIN_PASSWORD_${role}`];
    if (!password) throw new Error('Preview account credentials must be provided outside the repository');
    const hash = createHash('sha256').update(password).digest('hex');
    await client.query('update users set password_hash=$1 where role=$2', [hash, role.toLowerCase()]);
  }
  await client.query("update growth_records set occurred_at=now() - (floor(random()*4)::text || ' days')::interval, title=replace(replace(title,'演示',''),'测试',''), summary_parent=replace(replace(summary_parent,'演示',''),'测试',''), summary_student=replace(replace(summary_student,'演示',''),'测试','')");
  await client.query("update artifacts set visibility='school', updated_at=now()-interval '1 day', title=replace(replace(title,'演示',''),'测试','') where status='published'");
  await client.query("update projects set title=replace(replace(title,'演示',''),'测试','')");
  await client.query("update projects set status='practice_building',current_stage_index=5,stage_total=10,progress_percent=56,tags='[\"编程\",\"交互\"]',created_at=now()-interval '1 day' where id='project-demo-python'");
  await client.query("update projects set status='completed',current_stage_index=9,stage_total=10,progress_percent=100,tags='[\"植物\",\"观察\"]',completed_at=now()-interval '1 day' where id='project-demo-001'");
  await client.query("insert into artifacts(id,school_id,student_user_id,project_id,title,summary,status,visibility,current_version_index,tags,idempotency_key,published_at) values('art-family-observation','school-demo','student-demo','project-demo-001','校园植物观察手册','把不同位置的叶片观察整理成图文记录，并写下自己的解释。','published','school',2,'[\"观察记录\",\"图文表达\"]','family:published-observation',now()-interval '1 day') on conflict(id) do nothing");
  for (const ordinal of [1,2]) await client.query("insert into artifact_versions(id,artifact_id,ordinal,title,note,created_at) values($1,'art-family-observation',$2,$3,'整理观察的顺序，并补充解释依据。',now()-make_interval(days=>$4)) on conflict(id) do nothing", [`artv-family-observation-${ordinal}`,ordinal,ordinal===1?'第一版观察记录':'补充比较与解释',3-ordinal]);
  await client.query("insert into mentor_reviews(id,school_id,student_user_id,mentor_user_id,project_id,artifact_ref,kind,status,decision,comment,idempotency_key,reviewed_at) values('family-review-observation','school-demo','student-demo','teacher-demo','project-demo-001','art-family-observation','artifact','approved','approved','观察记录清楚，能够说明比较依据。','family:review-observation',now()-interval '1 day') on conflict(id) do nothing");
  await client.query("insert into growth_records(id,school_id,student_user_id,project_id,type,occurred_at,title,summary_student,summary_parent,artifact_ref,evidence_refs,source,visibility,idempotency_key) values('family-growth-artifact','school-demo','student-demo','project-demo-001','artifact_published',now()-interval '1 day','发布了校园植物观察手册','我把观察与解释整理成了一份可以分享的手册。','孩子保存并发布了植物观察手册，整理了观察记录和解释依据。','art-family-observation','[\"artifact:artv-family-observation-2\"]','server','guardian_visible','family:growth-artifact') on conflict(id) do nothing");
  await client.query("insert into project_evidence(id,project_id,student_user_id,column_kind,source_kind,source_id,label,occurred_at) values('family-help-plant','project-demo-001','student-demo','ai_helped','tutor_turn','family-explanation-prompt','AI 搭档提示按观察、比较、解释的顺序整理',now()-interval '1 day') on conflict do nothing");
  await client.query("insert into learning_session_progress(id,student_user_id,project_id,plan_id,plan_revision,learning_session_id,evidence_refs,idempotency_key,request_hash,completed_at) select 'family-session-completion','student-demo',p.project_id,p.id,p.version,s.id,'[\"artifact:artv-demo-python-2\"]','family:session-completion','family-scope-receipt',now()-interval '1 day' from learning_plans p join learning_sessions s on s.plan_id=p.id where p.id='plan-demo-python' order by s.index limit 1 on conflict do nothing");
  const partner = (await client.query('select id from tutor_partners order by id limit 1')).rows[0].id;
  const projects = (await client.query('select id,student_user_id from projects')).rows;
  for (const [index, project] of projects.entries()) {
    const session = `family-session-${index}`;
    await client.query("insert into tutor_sessions(id,student_id,partner_id,project_id,source,last_seq) values($1,$2,$3,$4,'project',12) on conflict(id) do nothing", [session, project.student_user_id, partner, project.id]);
    for (let turn = 0; turn < 12; turn++) {
      const role = turn % 2 === 0 ? 'student' : 'assistant';
      const expressions = project.id === 'project-demo-python'
        ? ['我想知道怎样检查输入是否是数字。','我发现空白输入时会出错，想再检查一次。','我会先列出几种输入情况，再比较程序的回应。']
        : ['我想比较不同位置的叶片有什么差别。','我观察到叶片的朝向有差别，想再记录一次。','我会保持观察时间和记录方式相同。'];
      const text = role === 'student' ? expressions[turn % 3] : '先记下预测，再用同样条件进行比较。';
      const minutes = (12 - turn) * 4;
      const days = Math.floor(turn / 4);
      await client.query('insert into tutor_turns(id,session_id,student_id,role,content,blocks,seq,created_at) values($1,$2,$3,$4,null,$5,$6,now()-make_interval(days=>$7,mins=>$8)) on conflict(id) do nothing',
        [`family-turn-${index}-${turn}`, session, project.student_user_id, role, JSON.stringify([{ kind: 'text', text }]), turn + 1, days, minutes]);
    }
    await client.query("insert into project_evidence(id,project_id,student_user_id,column_kind,source_kind,source_id,label,occurred_at) values($1,$2,$3,'difficulty','escalation_event',$1,'希望老师一起检查变量控制方案',now()-interval '3 hours') on conflict do nothing", [`family-support-${index}`, project.id, project.student_user_id]);
    await client.query("insert into project_evidence(id,project_id,student_user_id,column_kind,source_kind,source_id,label,occurred_at) values($1,$2,$3,'independent','reflection',$1,'回看了预测与观察的差异',now()-interval '1 day') on conflict do nothing", [`family-reflection-${index}`, project.id, project.student_user_id]);
    await client.query("insert into growth_records(id,school_id,student_user_id,project_id,type,occurred_at,title,summary_student,summary_parent,evidence_refs,source,visibility,idempotency_key) values($1,'school-demo',$2,$3,'reflection_created',now()-interval '1 day','回看了预测与观察的差异','我整理了观察记录，也写下下一步想继续验证的问题。','孩子整理了观察记录，并说明下一步准备如何验证。',$4,'server','guardian_visible',$1) on conflict(id) do nothing", [`family-growth-reflection-${index}`,project.student_user_id,project.id,JSON.stringify([`reflection:family-reflection-${index}`])]);
  }
  // Dialogue activity is randomized in the disposable database; it creates no mastery facts.
  for (const id of students) {
    const owned = projects.find(project => project.student_user_id === id);
    const session = `family-free-${id}`;
    await client.query("insert into tutor_sessions(id,student_id,partner_id,source,last_seq) values($1,$2,$3,'free',8) on conflict(id) do nothing", [session, id, partner]);
    for (let index = 0; index < 8; index++) {
      await client.query("insert into tutor_turns(id,session_id,student_id,role,blocks,seq,created_at) values($1,$2,$3,'student',$4,$5,now()-make_interval(days=>$6,mins=>$7)) on conflict(id) do nothing",
        [`family-free-turn-${id}-${index}`, session, id, JSON.stringify([{ kind: 'text', text: '我想继续比较观察结果和最初的预测。' }]), index + 1, index % 3, randomInt(15, 160)]);
    }
    if (!owned) continue;
  }
  const templates = [
    ['family-ticket-1','student-demo','parent-demo','processing','孩子在比较条纹时不确定应该先改变哪个变量，想请老师给一点引导。'],
    ['family-ticket-2','student-demo-3','parent-demo','replied','孩子已经整理好观察记录，希望听听老师对表达顺序的建议。'],
    ['family-ticket-3','student-demo','parent-demo','resolved','已经找到了保存作品的位置，孩子能够继续完善报告。'],
  ];
  for (const [id, child, parent, status, problem] of templates) {
    await client.query('insert into feedback_tickets(id,child_user_id,parent_user_id,source,status,problem,created_at,updated_at) values($1,$2,$3,\'general\',$4,$5,now()-interval \'1 day\',now()-interval \'2 hours\') on conflict(id) do nothing', [id, child, parent, status, problem]);
    await client.query("insert into feedback_ticket_entries(id,ticket_id,seq,kind,author_role,author_id,author_display_name,content,created_at) values($1,$2,1,'submitted','parent',$3,'林女士',$4,now()-interval '1 day') on conflict(id) do nothing", [`${id}-submitted`, id, parent, problem]);
    if (status !== 'processing') await client.query("insert into feedback_ticket_entries(id,ticket_id,seq,kind,author_role,author_id,author_display_name,content,created_at) values($1,$2,2,'replied','teacher','teacher-demo','李老师','可以先按预测、观察、解释的顺序整理，再选一组记录说明自己的理由。',now()-interval '2 hours') on conflict(id) do nothing", [`${id}-replied`, id]);
    if (status === 'resolved') await client.query("insert into feedback_ticket_entries(id,ticket_id,seq,kind,author_role,author_id,author_display_name,content,resolved,created_at) values($1,$2,3,'confirmed','parent',$3,'林女士','我们已经了解下一步如何继续，谢谢老师。',true,now()-interval '1 hour') on conflict(id) do nothing", [`${id}-confirmed`, id, parent]);
  }
  console.log(JSON.stringify({ database, students: students.length, families: 2, teachers: 2, projects: projects.length, scope: 'disposable preview only' }));
} finally { client.release(); await pool.end(); }
