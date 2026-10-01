const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), crypto = require('node:crypto');
module.exports = function fixture() {
  const now = new Date('2026-09-28T01:00:00Z');
  const state = { active: 'owner@example.test', effective: 'owner@example.test', locked: false, writes: [], reads: [], searches: [], failWrite: null, failFlush: false };
  const rows = {
    Topics: [['topicId','title','description','imageEnabled','commentEnabled','isActive'], ['tiling','敷き詰め','説明',true,true,true]],
    Posts: [['postId','topicId','authorId','displayName','title','body','imageFileId','createdAt','status','requestId','extra'],
      ['p1','tiling','author','作者','作品一','<img src=x onerror=alert(1)>','private-image',now,'published','request-post','keep'],
      ['p2','tiling','author','作者二','作品二','本文二','',now,'hidden','','keep'],
      ['p3','tiling','author','','削除作品','本文三','',now,'deleted','','keep']],
    Comments: [['commentId','postId','authorId','displayName','body','replyTo','createdAt','status','extra'],
      ['c1','p1','author','コメント作者','親コメント','',now,'published','keep'],
      ['c2','p1','author','返信作者','返信本文','c1',now,'published','keep'],
      ['c3','p1','author','','非公開コメント','',now,'hidden','keep'],
      ['c4','missing','author','','削除コメント','',now,'deleted','keep']],
    DeleteRequests: [['requestId','targetType','targetId','requesterId','reason','createdAt','status','extra'],
      ['r1','post','p1','requester','作品の申請理由',now,'pending','keep'],
      ['r2','comment','c1','requester','コメントの申請理由',now,'pending','keep'],
      ['r3','comment','c2','requester','却下用の理由',now,'pending','keep']]
  };
  const sheets = Object.fromEntries(Object.keys(rows).map(name => [name, {
    getLastColumn: () => rows[name][0].length, getLastRow: () => rows[name].length,
    getRange: (r,c,h,w) => ({
      getValues: () => { state.reads.push({name,r,c,h,w}); return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>rows[name][r-1+i]?.[c-1+j]??'')); },
      createTextFinder: text => {
        state.searches.push({name,r,c,h,w,text});
        const finder = {matchEntireCell:()=>finder,matchCase:()=>finder,useRegularExpression:()=>finder,
          findAll:()=>rows[name].slice(r-1,r-1+h).flatMap((row,i)=>row[c-1]===text?[{getRow:()=>r+i}]:[])};
        return finder;
      },
      setValues: values => {
        if (state.failWrite === name) throw Error('simulated write failure');
        state.writes.push({name,r,c,h,w});
        for(let i=0;i<h;i++){rows[name][r-1+i]??=[];for(let j=0;j<w;j++)rows[name][r-1+i][c-1+j]=values[i][j];}
      }
    })
  }]));
  const ctx = vm.createContext({ Date,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='SPREADSHEET_ID'?'sheet':'owner@example.test'})},
    Session:{getActiveUser:()=>({getEmail:()=>state.active}),getEffectiveUser:()=>({getEmail:()=>state.effective})},
    SpreadsheetApp:{openById:()=>({getSheetByName:name=>sheets[name]}),flush:()=>{if(state.failFlush)throw Error('flush failure');}},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(state.locked)return false;state.locked=true;return true;},releaseLock:()=>{state.locked=false;}})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')}
  });
  for(const file of ['Config.gs','TopicsService.gs','ModerationService.gs','PostsService.gs','CommentsService.gs','DeleteRequestsService.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
  return { rows, state, call: (method,payload)=>JSON.parse(JSON.stringify(ctx[method](payload))) };
};
