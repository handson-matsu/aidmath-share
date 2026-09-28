const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 for(const scenario of ['normal','lost','http','json','ack','timeout','retry','reload-saved','unknown','processing','post-processing','old-server','storage','two-tabs']) {
  const context=await browser.newContext();
  let saved=null,posts=[],lookups=0,recover=false,unknown=false;
  const errors=[];
  await context.addInitScript(({scenario})=>{
   const original=window.setTimeout;
   window.setTimeout=(fn,ms,...args)=>original(fn,ms===1500?5:scenario==='timeout'&&ms===90000?30:ms,...args);
   if(scenario==='storage') {const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('aidmath-share-delete-request-'))throw Error('storage blocked');return set.call(this,k,v);};}
  },{scenario});
  await context.route('https://aidmath.test/**',r=>{
   const file=new URL(r.request().url()).pathname.slice(1)||'index.html';
   return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  });
  await context.route('https://script.google.com/**',async r=>{
   const req=r.request(),url=new URL(req.url()),action=url.searchParams.get('action');
   if(url.searchParams.has('app'))return r.abort();
   let result;
   if(action==='topics')result={ok:true,topics:[{topicId:'t1',title:'テーマ'}]};
   if(action==='posts')result={ok:true,posts:[{postId:'p1',title:'作品'}]};
   if(action==='comments')result={ok:true,comments:recover&&scenario==='reload-saved'?[]:[{commentId:'c1',body:'コメント',createdAt:'2026-09-28T01:00:00Z'}]};
   if(action==='image')result={ok:true,hasImage:false};
   if(action==='deleteRequestStatus') {
    lookups++;
    if(unknown&&!recover)return r.abort();
    result=scenario==='old-server'?{ok:true,message:'old'}:{ok:true,protocol:'delete-request-v1',requestId:url.searchParams.get('requestId'),state:saved?'saved':scenario==='processing'&&!recover?'processing':'not_found'};
   }
   if(action==='requestDeleteV2') {
    const p=Object.fromEntries(new URLSearchParams(req.postData()));posts.push(p);
    assert.equal(p.reason,'テスト理由');assert.match(p.requestId,/^delete_[a-f0-9]{64}$/);
    if(['retry','reload-saved'].includes(scenario)&&posts.length===1)return r.abort();
    if(scenario==='post-processing'&&!recover)return r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,protocol:'delete-request-v1',requestId:p.requestId,state:'processing'})});
    if(saved)assert.equal(saved.requestId,p.requestId);else saved=p;
    if(scenario==='unknown'){unknown=true;return r.abort();}
    if(scenario==='lost')return r.abort();
    if(scenario==='http')return r.fulfill({status:502,body:'upstream error'});
    if(scenario==='json')return r.fulfill({contentType:'text/html',body:'not json'});
    if(scenario==='timeout')await new Promise(resolve=>setTimeout(resolve,100));
    result=scenario==='ack'?{message:'saved'}:{ok:true,protocol:'delete-request-v1',requestId:p.requestId,state:'saved'};
   }
   return r.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const open=async p=>{await p.goto('https://aidmath.test/#topic/t1/post/p1');await p.locator('.comment').getByRole('button',{name:'削除を申請',exact:true}).click();await p.getByLabel('申請理由').fill('テスト理由');};
  await open(page);
  let second;
  if(scenario==='two-tabs'){second=await context.newPage();await open(second);}
  const submit=p=>p.locator('#delete-form').evaluate(f=>{for(let i=0;i<3;i++)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await submit(page);
  if(second)await submit(second);
  if(scenario==='old-server') {
   await page.getByText('削除申請の確認機能がまだ利用できません。管理者にお知らせください。').waitFor();assert.equal(posts.length,0);
  }else if(scenario==='storage') {
   await page.getByText(/申請の確認情報を保存・読み込みできません/).waitFor();assert.equal(posts.length,0);
  }else if(scenario==='processing') {
   await page.getByText(/申請の保存確認が処理待ち/).waitFor();assert.equal(posts.length,0);
   recover=true;await page.getByRole('button',{name:'同じ申請を再確認・再送する'}).click();await page.locator('#delete-dialog').waitFor({state:'hidden'});assert.equal(posts.length,1);
  }else if(scenario==='post-processing') {
   await page.getByText(/現時点では保存を確認できません/).waitFor();assert.equal(await page.locator('#delete-form .form-error').textContent(),'');
   recover=true;await page.getByRole('button',{name:'同じ申請を再確認・再送する'}).click();await page.locator('#delete-dialog').waitFor({state:'hidden'});assert.equal(posts.length,2);assert.equal(posts[0].requestId,posts[1].requestId);
  }else if(['retry','reload-saved'].includes(scenario)) {
   await page.getByText(/現時点では保存を確認できません/).waitFor();assert.equal(posts.length,1);
   assert.equal(await page.getByLabel('申請理由').isDisabled(),true);
   if(scenario==='retry') {
    await page.getByRole('button',{name:'保存結果を確認する',exact:true}).click();await page.getByText(/現時点では保存を確認できません/).waitFor();assert.equal(posts.length,1);
    // Reload before retry must retain the original reason and request ID.
    await page.reload();await page.getByRole('button',{name:'コメントの未確認の削除申請を確認する'}).click();await page.getByText(/現時点では保存を確認できません/).waitFor();
    await page.getByRole('button',{name:'同じ申請を再確認・再送する'}).click();await page.locator('#delete-dialog').waitFor({state:'hidden'});assert.equal(posts.length,2);assert.equal(posts[0].requestId,posts[1].requestId);
   }else {
    saved=posts[0];recover=true;await page.reload();await page.getByRole('button',{name:'コメントの未確認の削除申請を確認する'}).click();await page.locator('#delete-dialog').waitFor({state:'hidden'});assert.equal(posts.length,1);
   }
  }else if(scenario==='unknown') {
   await page.getByText(/削除申請の保存結果が不明です/).waitFor();assert.equal(posts.length,1);
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:'/tmp/aidmath-delete-uncertain.png',fullPage:true});
   await page.getByRole('button',{name:'保存結果を確認する',exact:true}).click();await page.getByText(/申請情報を保持したまま確認を中断/).waitFor();assert.equal(posts.length,1);
   recover=true;await page.getByRole('button',{name:'保存結果を確認する',exact:true}).click();await page.locator('#delete-dialog').waitFor({state:'hidden'});assert.equal(posts.length,1);
  }else {
   await page.locator('#delete-dialog').waitFor({state:'hidden'});
   if(second)await second.locator('#delete-dialog').waitFor({state:'hidden'});
   assert.ok(posts.length>=1&&posts.length<=(second?2:1));
   if(second)assert.ok(posts.every(p=>p.requestId===posts[0].requestId));
  }
  if(!['old-server','storage'].includes(scenario)) {
   assert.match(await page.locator('#notice').textContent(),/削除申請を送信しました/);
   assert.equal(await page.locator('#pending-deletes button').count(),0);
   if(scenario!=='reload-saved') {
    const count=posts.length;await page.locator('.comment').getByRole('button',{name:'削除を申請',exact:true}).click();
    await page.getByText('この対象の削除申請は送信済みです。管理者が確認します。').waitFor();assert.equal(await page.locator('#delete-form [type=submit]').isDisabled(),true);assert.equal(posts.length,count);
   }
  }
  assert.deepEqual(errors,[]);await context.close();console.log('PASS delete browser:',scenario);
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
