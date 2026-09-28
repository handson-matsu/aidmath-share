const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function fixture(){
 const rows={
  DeleteRequests:[['requestId','targetType','targetId','requesterId','reason','createdAt','status'],['legacy_request','post','p1','legacy','old',new Date(),'pending']],
  Posts:[['postId','topicId','authorId','displayName','title','body','imageFileId','createdAt','status','requestId'],['p1','t1','a','name','title','body','image',new Date(),'published','keep']],
  Comments:[['commentId','postId','authorId','displayName','body','replyTo','createdAt','status'],['c1','p1','a','name','comment','',new Date(),'published']]
 };
 let locked=false,failFlush=false,duringAppend=null,appends=0;
 const ctx=vm.createContext({getSheet:name=>({getDataRange:()=>({getValues:()=>rows[name].map(r=>[...r])}),appendRow:row=>{if(duringAppend)duringAppend();rows[name].push(row);appends++;}}),LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},SpreadsheetApp:{flush:()=>{if(failFlush)throw Error('lost response');}}});
 vm.runInContext(fs.readFileSync('gas/delete-requests.gs','utf8'),ctx);
 return {rows,ctx,get appends(){return appends;},set locked(v){locked=v;},set failFlush(v){failFlush=v;},set duringAppend(v){duringAppend=v;}};
}
const payload={requestId:'delete_'+'a'.repeat(64),requesterId:'author-12345678901234567890',targetType:'comment',targetId:'c1',reason:'テスト理由'};
{
 const f=fixture(), original=structuredClone(f.rows);
 assert.equal(f.ctx.getDeleteRequestStatus(payload).state,'not_found');
 f.duringAppend=()=>{assert.equal(f.ctx.requestDeleteWithId(payload).state,'processing');assert.equal(f.ctx.getDeleteRequestStatus(payload).state,'processing');};
 assert.equal(f.ctx.requestDeleteWithId(payload).state,'saved');f.duringAppend=null;
 for(let i=0;i<5;i++)assert.equal(f.ctx.requestDeleteWithId(payload).state,'saved');
 assert.equal(f.appends,1);assert.equal(f.rows.DeleteRequests[2][6],'pending');assert.equal(f.rows.DeleteRequests[2].length,7);
 assert.equal(f.ctx.getDeleteRequestStatus(payload).state,'saved');
 assert.deepEqual(f.rows.Posts,original.Posts);assert.deepEqual(f.rows.Comments,original.Comments);assert.deepEqual(f.rows.DeleteRequests[1],original.DeleteRequests[1]);
 for(const status of ['approved','rejected']){f.rows.DeleteRequests[2][6]=status;f.rows.Comments[1][7]='deleted';f.rows.Posts[1][8]='hidden';assert.equal(f.ctx.requestDeleteWithId(payload).state,'saved');assert.equal(f.ctx.getDeleteRequestStatus(payload).state,'saved');}
 assert.equal(f.appends,1);
 assert.throws(()=>f.ctx.requestDeleteWithId({...payload,reason:'changed'}));
 assert.throws(()=>f.ctx.requestDeleteWithId({...payload,targetType:'post',targetId:'p1'}));
 assert.throws(()=>f.ctx.getDeleteRequestStatus({...payload,requesterId:'other-12345678901234567890'}));
 assert.throws(()=>f.ctx.requestDeleteWithId({...payload,requesterId:'other-12345678901234567890'}));
 const result=f.ctx.getDeleteRequestStatus(payload);assert.deepEqual(Object.keys(result).sort(),['ok','protocol','requestId','state']);
}
{
 const f=fixture();f.failFlush=true;assert.throws(()=>f.ctx.requestDeleteWithId(payload));f.failFlush=false;
 assert.equal(f.ctx.getDeleteRequestStatus(payload).state,'saved');assert.equal(f.ctx.requestDeleteWithId(payload).state,'saved');assert.equal(f.appends,1);
}
{
 const f=fixture();
 for(const patch of [{requestId:''},{requesterId:''},{targetType:'other'},{targetId:'missing'},{reason:''},{reason:'=IMPORTXML(x)'},{reason:'x'.repeat(2001)}])assert.throws(()=>f.ctx.requestDeleteWithId({...payload,...patch}));
 f.rows.Comments[1][7]='hidden';assert.throws(()=>f.ctx.requestDeleteWithId(payload));f.rows.Comments[1][7]='published';f.rows.Posts[1][8]='deleted';assert.throws(()=>f.ctx.requestDeleteWithId(payload));
 assert.equal(f.appends,0);
 f.rows.Posts[1][8]='published';assert.equal(f.ctx.requestDeleteWithId({...payload,targetType:'post',targetId:'p1'}).state,'saved');
}
{
 const f=fixture();f.rows.DeleteRequests[0][6]='wrong';assert.throws(()=>f.ctx.requestDeleteWithId(payload));assert.throws(()=>f.ctx.getDeleteRequestStatus(payload));assert.equal(f.appends,0);
}
{
 const f=fixture();f.rows.DeleteRequests.push([...f.rows.DeleteRequests[1]]);assert.throws(()=>f.ctx.requestDeleteWithId(payload));assert.equal(f.appends,0);
}
console.log('PASS deletion GAS: ID deduplication, concurrent lock contention, saved lookup, response loss, approval/rejection, immutable payload, owner matching, validation, schema, legacy rows, seven-column compatibility');
