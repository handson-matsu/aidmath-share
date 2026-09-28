const assert = require('node:assert/strict');
const fixture = require('./moderation-fixture.cjs');
const ok = result => { assert.equal(result.ok,true,JSON.stringify(result)); return result.data; };
function item(f,type,id) { return ok(f.call(type==='post'?'adminListPosts':'adminListComments')).find(r=>r.id===id); }
function set(f,type,id,status,revision) { return f.call(type==='post'?'adminSetPostStatus':'adminSetCommentStatus',{id,status,revision:revision??item(f,type,id).revision}); }
function request(f,id,decision='approved') { const r=ok(f.call('adminListDeleteRequests')).find(r=>r.id===id); return {id,decision,revision:r.revision,...(decision==='approved'?{targetRevision:r.target?.contentRevision,targetStatus:r.target?.status}:{})}; }
{
 const f=fixture(), before=structuredClone(f.rows);
 const posts=ok(f.call('adminListPosts')); assert.equal(posts.length,3); assert.equal(posts[0].topicTitle,'敷き詰め'); assert.equal(posts[0].createdAt,'2026-09-28T01:00:00.000Z'); assert.ok(!('authorId' in posts[0]));
 assert.equal(ok(f.call('adminListComments')).length,4);
 for(const type of ['post','comment']) {
  const id=type==='post'?'p1':'c1', stale=item(f,type,id).revision;
  ok(set(f,type,id,'hidden')); assert.equal(set(f,type,id,'published',stale).error.code,'CONFLICT');
  ok(set(f,type,id,'published')); ok(set(f,type,id,'deleted')); assert.equal(set(f,type,id,'published').error.code,'STATUS');
 }
 assert.equal(f.rows.Comments[2][7],'published','reply remains published');
 for(const [name,col] of [['Posts',8],['Comments',7]]) {
  for(let i=1;i<f.rows[name].length;i++) assert.deepEqual(f.rows[name][i].filter((_,j)=>j!==col),before[name][i].filter((_,j)=>j!==col));
 }
 assert.ok(f.state.writes.every(w=>w.h===1&&w.w===1&&w.c===(w.name==='Posts'?9:8)));
}
{
 const f=fixture();
 // Reordering between read and write must still resolve by ID.
 const revision=item(f,'post','p1').revision;
 [f.rows.Posts[1],f.rows.Posts[2]]=[f.rows.Posts[2],f.rows.Posts[1]];
 ok(set(f,'post','p1','hidden',revision)); assert.equal(f.rows.Posts.find(r=>r[0]==='p1')[8],'hidden'); assert.equal(f.rows.Posts.find(r=>r[0]==='p2')[8],'hidden');
 const revision2=item(f,'post','p1').revision; f.rows.Posts.find(r=>r[0]==='p1')[5]='changed'; assert.equal(set(f,'post','p1','published',revision2).error.code,'CONFLICT');
 f.rows.Comments[1][7]='unexpected'; assert.equal(set(f,'comment','c1','deleted').error.code,'STATUS');
 assert.equal(set(f,'post','p2','bogus').error.code,'VALIDATION');
 assert.equal(f.call('adminSetPostStatus',{id:'missing',status:'hidden',revision:'r'}).error.code,'NOT_FOUND');
 f.rows.Posts[0][8]='wrong'; assert.equal(f.call('adminListPosts').error.code,'SCHEMA');
}
{
 const f=fixture(), p=request(f,'r1'); ok(f.call('adminResolveDeleteRequest',p));
 assert.equal(f.rows.Posts[1][8],'deleted'); assert.equal(f.rows.DeleteRequests[1][6],'approved');
 const count=f.state.writes.length; assert.equal(f.call('adminResolveDeleteRequest',p).ok,false); assert.equal(f.state.writes.length,count);
 ok(f.call('adminResolveDeleteRequest',request(f,'r2'))); assert.equal(f.rows.Comments[1][7],'deleted'); assert.equal(f.rows.Comments[2][7],'published');
 ok(f.call('adminResolveDeleteRequest',request(f,'r3','rejected'))); assert.equal(f.rows.Comments[2][7],'published'); assert.equal(f.rows.DeleteRequests[3][6],'rejected');
 assert.ok(f.state.writes.every(w=>w.w===1&&w.h===1));
}
{
 const f=fixture(), p=request(f,'r1'); f.state.failWrite='DeleteRequests';
 assert.equal(f.call('adminResolveDeleteRequest',p).ok,false); assert.equal(f.rows.Posts[1][8],'deleted'); assert.equal(f.rows.DeleteRequests[1][6],'pending');
 f.state.failWrite=null; ok(f.call('adminResolveDeleteRequest',p)); assert.equal(f.rows.DeleteRequests[1][6],'approved');
 assert.equal(f.state.writes.filter(w=>w.name==='Posts').length,1,'partial retry does not repeat target write');
}
{
 const f=fixture(), p=request(f,'r1'); f.state.failFlush=true;
 assert.equal(f.call('adminResolveDeleteRequest',p).ok,false); assert.equal(f.rows.DeleteRequests[1][6],'pending');
 f.state.failFlush=false; ok(f.call('adminResolveDeleteRequest',p));
}
{
 const f=fixture(); let p=request(f,'r1'); f.rows.Posts[1][5]='changed'; assert.equal(f.call('adminResolveDeleteRequest',p).error.code,'CONFLICT');
 p=request(f,'r1'); f.rows.Posts[1][8]='hidden'; assert.equal(f.call('adminResolveDeleteRequest',p).error.code,'CONFLICT');
 f.rows.Posts[1][8]='unexpected'; assert.equal(f.call('adminResolveDeleteRequest',request(f,'r1')).error.code,'STATUS');
 f.rows.DeleteRequests[1][2]='missing'; assert.equal(f.call('adminResolveDeleteRequest',request(f,'r1')).error.code,'NOT_FOUND');
 ok(f.call('adminResolveDeleteRequest',request(f,'r1','rejected')));
 f.rows.DeleteRequests[2][1]='unknown'; assert.equal(f.call('adminResolveDeleteRequest',request(f,'r2')).ok,false);
 f.rows.DeleteRequests[3][6]='unexpected'; assert.equal(f.call('adminResolveDeleteRequest',{id:'r3',decision:'rejected',revision:'r'}).error.code,'STATUS');
}
{
 const f=fixture(); f.rows.Posts.push([...f.rows.Posts[1]]); assert.equal(f.call('adminListPosts').error.code,'SCHEMA'); assert.equal(f.state.writes.length,0);
}
{
 const f=fixture(); const p=request(f,'r1'), post=item(f,'post','p1'), comment=item(f,'comment','c1');
 for(const active of ['','other@example.test']) {
  f.state.active=active;
  for(const [method,payload] of [['adminListPosts'],['adminListComments'],['adminListDeleteRequests'],['adminSetPostStatus',{id:post.id,status:'hidden',revision:post.revision}],['adminSetCommentStatus',{id:comment.id,status:'hidden',revision:comment.revision}],['adminResolveDeleteRequest',p]]) assert.equal(f.call(method,payload).error.code,'FORBIDDEN');
 }
 f.state.active='owner@example.test'; f.state.locked=true;
 assert.equal(f.call('adminResolveDeleteRequest',p).error.code,'BUSY'); assert.equal(set(f,'post','p1','hidden',post.revision).error.code,'BUSY'); assert.equal(f.state.writes.length,0);
}
console.log('PASS moderation: auth, schemas, status transitions, ID lookup, revision conflicts, single-cell writes, replies preserved, approvals/rejections, duplicate prevention, partial failure recovery');
