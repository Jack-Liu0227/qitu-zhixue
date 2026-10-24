import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const origin='http://127.0.0.1:4200';
const accounts=(await(await fetch(`${origin}/api/v1/auth/test-accounts`)).json()).data.accounts;
async function login(role){const r=await fetch(`${origin}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(accounts.find(a=>a.role===role))});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];}
async function call(cookie,path,body,key=randomUUID(),method){
 const r=await fetch(`${origin}/api/v1${path}`,{method:method??(body?'POST':'GET'),headers:{cookie,'content-type':'application/json','idempotency-key':key},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,body:await r.json()};
}
const [parent,teacher,student]=await Promise.all(['parent','teacher','student'].map(login));
const file={childId:'student-demo',fileName:'条纹观察记录.txt',contentType:'text/plain',base64:Buffer.from('固定屏距，比较两种缝宽下的条纹变化。').toString('base64')};
const key=randomUUID();
const uploads=await Promise.all([1,2,3].map(()=>call(parent,'/feedback/attachments',file,key)));
assert.ok(uploads.every(r=>r.status===201));const id=uploads[0].body.data.id;
assert.ok(uploads.every(r=>r.body.data.id===id));
assert.equal((await call(parent,'/feedback/attachments',{...file,base64:Buffer.from('另一份记录').toString('base64')},key)).status,409);
assert.equal((await call(parent,'/feedback/attachments',{...file,childId:'student-demo-2'})).status,403);
assert.equal((await call(parent,'/feedback/attachments',{...file,fileName:'record.png',contentType:'image/png'})).status,400);
assert.equal((await call(parent,'/feedback/attachments',{...file,contentType:'text/html'})).status,400);
assert.equal((await call(parent,'/feedback/attachments',{...file,base64:Buffer.alloc(2097153,65).toString('base64')})).status,400);
assert.equal((await fetch(`${origin}/api/v1/feedback/attachments/${id}/content`,{headers:{cookie:student}})).status,403);
assert.equal((await fetch(`${origin}/api/v1/feedback/attachments/${id}/content`,{headers:{cookie:teacher}})).status,404);
const wrong=await call(parent,'/parent/feedback',{childId:'student-demo-3',source:'general',content:'请帮助梳理观察记录。',attachmentRefs:[id]});
assert.equal(wrong.status,400);
const submitted=await call(parent,'/parent/feedback',{childId:'student-demo',source:'general',content:'请老师看看这份条纹观察记录，帮忙指出还需要补充的比较条件。',attachmentRefs:[id]});
assert.equal(submitted.status,201);const ticketId=submitted.body.data.ticketId;
const detail=await call(teacher,`/teacher/feedback/${ticketId}`);
assert.equal(detail.status,200);assert.equal(detail.body.data.ticket.entries[0].attachments[0].fileName,file.fileName);
assert.ok(!JSON.stringify(detail.body).includes('base64'));
const downloaded=await fetch(`${origin}/api/v1/feedback/attachments/${id}/content`,{headers:{cookie:teacher}});
assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(file.base64,'base64'));
assert.match(downloaded.headers.get('cache-control'),/no-store/);assert.match(downloaded.headers.get('content-disposition'),/attachment;/);
assert.equal((await call(parent,`/feedback/attachments/${id}`,null,undefined,'DELETE')).status,409);
const teacherFile={...file,fileName:'观察补充建议.txt',base64:Buffer.from('比较时请同时记录缝宽、屏距和波长，每次只改变一个条件。').toString('base64')};
const teacherUpload=await call(teacher,'/feedback/attachments',teacherFile);assert.equal(teacherUpload.status,201);
assert.equal((await call(teacher,`/teacher/feedback/${ticketId}/replies`,{content:'请补充比较条件。',attachmentRefs:[id]})).status,400);
const reply=await call(teacher,`/teacher/feedback/${ticketId}/replies`,{content:'可以按附件中的提示补充观察条件。',attachmentRefs:[teacherUpload.body.data.id]});
assert.equal(reply.status,200);
const parentView=await call(parent,`/parent/feedback/${ticketId}`);assert.equal(parentView.body.data.ticket.entries.at(-1).attachments[0].fileName,teacherFile.fileName);
const readReply=await fetch(`${origin}/api/v1/feedback/attachments/${teacherUpload.body.data.id}/content`,{headers:{cookie:parent}});
assert.equal(readReply.status,200);assert.deepEqual(Buffer.from(await readReply.arrayBuffer()),Buffer.from(teacherFile.base64,'base64'));
const draft=await call(parent,'/feedback/attachments',file);assert.equal(draft.status,201);
for(let i=0;i<2;i++)assert.equal((await call(parent,`/feedback/attachments/${draft.body.data.id}`,null,undefined,'DELETE')).status,200);
assert.equal((await fetch(`${origin}/api/v1/feedback/attachments/${draft.body.data.id}/content`,{headers:{cookie:parent}})).status,404);
assert.equal((await call(parent,'/parent/feedback',{childId:'student-demo',source:'general',content:'再次发起沟通。',attachmentRefs:[id]})).status,400);
assert.equal((await call(parent,'/parent/feedback',{childId:'student-demo',source:'general',content:'附件数量检查。',attachmentRefs:Array.from({length:6},()=>randomUUID())})).status,400);
const capacityFile={...file,base64:Buffer.alloc(2097152,65).toString('base64')};
const capacity=await Promise.all(Array.from({length:12},()=>call(parent,'/feedback/attachments',capacityFile)));
assert.ok(capacity.some(r=>r.status===201)&&capacity.some(r=>r.status===409));
assert.ok(capacity.filter(r=>r.status===201).length<=9,'Concurrent requests must not bypass the owner quota');
for(const result of capacity.filter(r=>r.status===201))await call(parent,`/feedback/attachments/${result.body.data.id}`,null,undefined,'DELETE');
if(process.env.DATABASE_URL){
 assert.match(new URL(process.env.DATABASE_URL).pathname,/^\/qitu_family_preview_\d{8}$/,'SQL checks only run on the disposable fixture');
 const {Pool}=createRequire(new URL('../services/api/package.json',import.meta.url))('pg');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const expiring=await call(parent,'/feedback/attachments',file);assert.equal(expiring.status,201);
 await pool.query("UPDATE feedback_attachments SET expires_at=now()-interval '1 second' WHERE id=$1 AND ticket_id IS NULL",[expiring.body.data.id]);
 assert.equal((await fetch(`${origin}/api/v1/feedback/attachments/${expiring.body.data.id}/content`,{headers:{cookie:parent}})).status,404);
 const sweep=await call(parent,'/feedback/attachments',file);assert.equal(sweep.status,201);
 assert.equal((await pool.query('SELECT id FROM feedback_attachments WHERE id=$1',[expiring.body.data.id])).rows.length,0);
 await call(parent,`/feedback/attachments/${sweep.body.data.id}`,null,undefined,'DELETE');
 const assignments=await pool.query("SELECT id FROM mentor_assignments WHERE mentor_user_id='teacher-demo' AND student_user_id='student-demo' AND status='active'");
 const guardians=await pool.query("SELECT id FROM guardian_links WHERE parent_user_id='parent-demo' AND student_user_id='student-demo' AND status='active'");
 assert.ok(assignments.rows.length&&guardians.rows.length);
 try{
  await pool.query("UPDATE mentor_assignments SET status='ended' WHERE id=ANY($1)",[assignments.rows.map(r=>r.id)]);
  assert.equal((await fetch(`${origin}/api/v1/feedback/attachments/${id}/content`,{headers:{cookie:teacher}})).status,403);
  await pool.query("UPDATE guardian_links SET status='ended' WHERE id=ANY($1)",[guardians.rows.map(r=>r.id)]);
  assert.equal((await fetch(`${origin}/api/v1/feedback/attachments/${id}/content`,{headers:{cookie:parent}})).status,403);
  assert.equal((await call(parent,'/feedback/attachments',file,key)).status,403,'Replay must recheck the current guardian relationship');
 }finally{
  await pool.query("UPDATE mentor_assignments SET status='active' WHERE id=ANY($1)",[assignments.rows.map(r=>r.id)]);
  await pool.query("UPDATE guardian_links SET status='active' WHERE id=ANY($1)",[guardians.rows.map(r=>r.id)]);
  await pool.end();
 }
}
console.log(JSON.stringify({success:true,checkedAt:new Date().toISOString(),checks:['concurrent upload replay','hash conflicts','cross-child permissions','draft privacy','strict file types and size','transactional child binding','owner-only references','authorized binary downloads','teacher attachments in parent timeline','idempotent draft removal','single-ticket binding','attachment count limits','concurrent storage quotas',...(process.env.DATABASE_URL?['expired draft cleanup','immediate revocation and replay authorization']:[])],ticketId,attachmentIds:[id,teacherUpload.body.data.id]}));
