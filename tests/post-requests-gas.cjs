const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
let locked = false, images = 0, serial = 0, duringSave, failFlush = false;
const rows = [['postId','topicId','authorId','displayName','title','body','imageFileId','createdAt','status','requestId'], ['old','tiling','old-author','','old','','',new Date(),'published']];
const context = vm.createContext({
  cleanText:(v,n)=>String(v||'').slice(0,n).trim(),
  getTopics:()=>[{topicId:'tiling',imageEnabled:true}],
  makeId:()=>`post-${++serial}`,
  getSheet:()=>({getDataRange:()=>({getValues:()=>rows.map(row=>[...row])}),appendRow:row=>rows.push(row)}),
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
  SpreadsheetApp:{flush:()=>{if(failFlush)throw Error('response uncertain');}},
  saveImage:()=>{images++;if(duringSave)duringSave();return 'private-file';}
});
vm.runInContext(fs.readFileSync('gas/post-requests.gs','utf8'),context);
const payload={topicId:'tiling',authorId:'author',requestId:'request-12345678901234567890',title:'test',imageData:'abc',imageType:'image/png'};
duringSave=()=>{
  assert.equal(context.createPost(payload).state,'processing');
  assert.equal(context.getPostStatus(payload).state,'processing');
};
assert.equal(context.getPostStatus(payload).state,'not_found');
const first=context.createPost(payload);duringSave=null;
assert.equal(first.state,'saved');
for(let i=0;i<5;i++)assert.equal(context.createPost({...payload,title:'changed'}).postId,first.postId);
assert.equal(rows.length,3);assert.equal(images,1);
assert.equal(context.getPostStatus(payload).postId,first.postId);
assert.throws(()=>context.getPostStatus({...payload,authorId:'other'}));
failFlush=true;
const second={...payload,requestId:'request-22345678901234567890'};
assert.throws(()=>context.createPost(second));failFlush=false;
assert.equal(context.getPostStatus(second).state,'saved');
context.createPost(second);assert.equal(rows.length,4);assert.equal(images,2);
assert.equal(rows[1][0],'old');assert.equal(rows[1][9],undefined);
context.createPost({...payload,requestId:''});assert.equal(rows.length,5);
console.log('PASS GAS: concurrent lock contention, repeated ID, lost response after write, ownership, legacy rows and legacy client');
