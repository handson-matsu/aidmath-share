const assert = require('node:assert/strict');
const fixture = require('./moderation-fixture.cjs');
const ok = r => {assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
function populated(n=10003) {
 const f=fixture(); f.rows.Comments.length=1;
 f.rows.Posts.push(['p4','tiling','','','不明状態','','',new Date(),'unexpected']);
 for(let i=1;i<=n;i++) f.rows.Comments.push(['c'+i,['p1','p2','p3','missing','p4'][i%5],'author','name','本文'+i,i%2?'':'c1',new Date(1000000-i),['published','hidden','deleted'][i%3],'keep']);
 return f;
}
const states=['all','published','hidden','deleted'];
const parents=['all','published','hidden','deleted','unknown'];
{
 const f=populated(), initial=structuredClone(f.rows);
 for(const status of states) for(const postStatus of parents) {
  const expected=f.rows.Comments.slice(1).filter(r=>(status==='all'||r[7]===status)&&(postStatus==='all'||({p1:'published',p2:'hidden',p3:'deleted'}[r[1]]||'unknown')===postStatus)).reverse().map(r=>r[0]);
  const found=[], pages=[]; let args={status,postStatus};
  do {
   const p=ok(f.call('adminListComments',args));assert.ok(p.items.length<=50);pages.push({args,p});found.push(...p.items.map(x=>x.id));
   if(p.nextRow===null)break;
   args={status,postStatus,snapshotRow:p.snapshotRow,startRow:p.nextRow};
  } while(true);
  assert.deepEqual(found,expected,`${status}/${postStatus}`);assert.equal(new Set(found).size,found.length);
  for(const {args,p} of [pages[0],pages[Math.floor(pages.length/2)],pages[pages.length-1]]) assert.deepEqual(ok(f.call('adminListComments',args)).items,p.items,'previous page anchor');
 }
 assert.deepEqual(f.rows,initial);assert.equal(f.state.writes.length,0);
 assert.ok(f.state.reads.filter(r=>r.name==='Comments'&&r.r>1).every(r=>r.h<=100&&r.w===8));
 assert.ok(f.state.reads.filter(r=>r.name==='Posts'&&r.r>1).every(r=>r.h===1&&r.c===5&&r.w===5));
 assert.ok(f.state.searches.every(r=>r.c===1&&r.w===1));
 console.log('PASS 10,003 comments: all 20 filter combinations, complete traversal, previous anchors, no duplicates/omissions, bounded reads, no writes');
}
{
 const f=populated();f.state.reads=[];f.state.searches=[];
 const first=ok(f.call('adminListComments'));
 assert.equal(first.items.length,50);assert.equal(first.items[0].id,'c10003');
 assert.equal(f.state.reads.filter(r=>r.name==='Comments'&&r.r>1).length,1);
 assert.equal(f.state.searches.length,5,'one lookup per distinct post in RPC');
 f.rows.Comments.push(['new','p1','','','new','',new Date(),'published']);
 const second=ok(f.call('adminListComments',{snapshotRow:first.snapshotRow,startRow:first.nextRow}));
 assert.equal(second.items[0].id,'c9953');assert.ok(!second.items.some(x=>first.items.some(y=>y.id===x.id)));
 assert.equal(ok(f.call('adminListComments')).items[0].id,'new');
 // A rare filter must continue past 1,000 rows in the SAME RPC.
 for(const r of f.rows.Comments.slice(1))r[7]='published';f.rows.Comments[1][7]='deleted';
 f.state.reads=[];const rare=ok(f.call('adminListComments',{status:'deleted'}));
 assert.deepEqual(rare.items.map(x=>x.id),['c1']);assert.equal(rare.nextRow,null);
 assert.ok(f.state.reads.filter(r=>r.name==='Comments'&&r.r>1).length>100);
}
{
 for(const parent of ['p1','p2','p3','missing','p4']) {
  const f=populated(0); f.rows.Comments.push(['x',parent,'a','n','body','',new Date(),'hidden','keep']);
  const item=ok(f.call('adminListComments')).items[0];
  const payload={id:'x',status:'published',revision:item.revision};
  const result=f.call('adminSetCommentStatus',payload);
  if(parent==='p1')ok(result);else {assert.equal(result.error.code,'PARENT_STATUS');assert.equal(f.state.writes.length,0);}
  let latest=ok(f.call('adminListComments')).items[0];
  ok(f.call('adminSetCommentStatus',{id:'x',status:'hidden',revision:latest.revision}));
  latest=ok(f.call('adminListComments')).items[0];
  ok(f.call('adminSetCommentStatus',{id:'x',status:'deleted',revision:latest.revision}));
  latest=ok(f.call('adminListComments')).items[0];
  assert.equal(f.call('adminSetCommentStatus',{id:'x',status:'published',revision:latest.revision}).error.code,'STATUS');
  assert.equal(f.rows.Comments[1][8],'keep');
 }
 const f=fixture(), item=ok(f.call('adminListComments')).items.find(r=>r.id==='c3');
 f.rows.Posts[1][8]='hidden';
 assert.equal(f.call('adminSetCommentStatus',{id:'c3',status:'published',revision:item.revision}).error.code,'PARENT_STATUS','parent is rechecked at write time');
 f.rows.Posts[1][8]='published';f.rows.Comments[3][4]='changed';
 assert.equal(f.call('adminSetCommentStatus',{id:'c3',status:'published',revision:item.revision}).error.code,'CONFLICT');
}
{
 const f=fixture(); f.rows.Comments.length=1;
 assert.deepEqual(ok(f.call('adminListComments')).items,[]);
 f.rows.Comments.push(['','','','','','','','']);assert.deepEqual(ok(f.call('adminListComments')).items,[]);
 for(const args of [{status:'bad'},{postStatus:'bad'},{startRow:0},{snapshotRow:999},{startRow:1.5},{limit:1000},null]) assert.equal(f.call('adminListComments',args).ok,false);
 const g=fixture();g.rows.Posts.push([...g.rows.Posts[1]]);assert.equal(g.call('adminListComments').error.code,'SCHEMA');
 const h=fixture();h.rows.Comments.push([...h.rows.Comments[1]]);assert.equal(h.call('adminSetCommentStatus',{id:'c1',status:'hidden',revision:'x'}).error.code,'SCHEMA');
}
console.log('PASS page snapshots, sparse filters, parent restrictions, stale writes, empty/invalid pages, duplicate IDs');

{
 for(const n of [0,1,49,50,51,99,100,101]) {
  const f=populated(n); if(n>2)f.rows.Comments.splice(2,0,['','','','','','','','']);
  const seen=[];let p=ok(f.call('adminListComments'));
  while(true){seen.push(...p.items.map(r=>r.id));if(p.nextRow===null)break;p=ok(f.call('adminListComments',{snapshotRow:p.snapshotRow,startRow:p.nextRow}));}
  assert.deepEqual(seen,Array.from({length:n},(_,i)=>'c'+(n-i)));
 }
 for(const parent of ['p2','p3','missing']) {
  const f=fixture();f.rows.Comments[1][1]=parent;
  const item=ok(f.call('adminListComments')).items.find(r=>r.id==='c1');
  f.state.reads=[];
  ok(f.call('adminSetCommentStatus',{id:item.id,status:'hidden',revision:item.revision}));
  assert.equal(f.rows.Comments[1][7],'hidden');
  assert.ok(f.state.reads.filter(r=>r.name==='Comments'&&r.r>1).every(r=>r.h===1));
  assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].c,8);
 }
 console.log('PASS exact 50/100 boundaries, blank rows, nonpublic-parent hide and single-row update');
}
