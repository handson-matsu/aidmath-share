const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 for(const scenario of ['normal','lost-after-save','retry','reload','status-unavailable','old-server']) {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let saved=null,requests=[],statusCalls=0;
  await page.route('https://aidmath.test/**',r=>{
   const f=new URL(r.request().url()).pathname.slice(1)||'index.html';
   return r.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(f)});
  });
  await page.route('https://script.google.com/**',async r=>{
   const req=r.request(),u=new URL(req.url()),action=u.searchParams.get('action');
   if(u.searchParams.has('app'))return r.abort();
   let result;
   if(action==='topics') result={ok:true,topics:[{topicId:'t1',title:'テーマ'}]};
   if(action==='posts') result={ok:true,posts:saved?[{...saved,postId:'p1',createdAt:'2026-09-28T00:00:00Z'}]:[]};
   if(action==='image') result={ok:true,hasImage:false};
   if(action==='postStatus') {
    statusCalls++;
    if(scenario==='status-unavailable' && statusCalls>1)return r.abort();
    result=scenario==='old-server'?{ok:true,message:'old'}:{ok:true,protocol:'post-request-v1',requestId:u.searchParams.get('requestId'),state:saved?'saved':'not_found',...(saved?{postId:'p1'}:{})};
   }
   if(action==='createPost') {
    const p=Object.fromEntries(new URLSearchParams(req.postData()));requests.push(p);
    if((scenario==='retry'||scenario==='reload')&&requests.length===1)return r.abort();
    saved=p;
    if(scenario==='lost-after-save'||scenario==='status-unavailable')return r.abort();
    result={ok:true,protocol:'post-request-v1',state:'saved',requestId:p.requestId,postId:'p1'};
   }
   return r.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
  });
  await page.goto('https://aidmath.test/#topic/t1/new');
  await page.getByLabel('タイトル').fill('確認作品');
  await page.getByLabel('作品画像').setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await page.locator('.preview').waitFor({state:'visible'});
  // Dispatching multiple submit events also tests the guard beyond a disabled button.
  await page.locator('form.panel').evaluate(f=>{for(let i=0;i<3;i++)f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  if(scenario==='old-server') {
   await page.getByText('投稿結果の確認機能がまだ利用できません。管理者にお知らせください。').waitFor();
   assert.equal(requests.length,0);
  }else if(scenario==='status-unavailable') {
   await page.getByText(/投稿結果をまだ確認できません/).waitFor();
   assert.equal(requests.length,1);assert.equal(await page.getByLabel('タイトル').isDisabled(),true);
   assert.ok(await page.evaluate(()=>localStorage.getItem('aidmath-share-pending-post-t1')));
  }else if(scenario==='retry'||scenario==='reload') {
   await page.getByText(/投稿結果をまだ確認できません/).waitFor();
   assert.equal(requests.length,1);
   assert.equal(await page.getByLabel('タイトル').isDisabled(),true);
   if(scenario==='retry') {
    await page.getByRole('button',{name:'同じ投稿を再確認・再送する'}).click();
    await page.getByRole('heading',{name:'確認作品'}).waitFor();
    assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);
   }else {
    // Original server execution completes after client lost its response.
    saved=requests[0];await page.reload();
    await page.getByRole('heading',{name:'確認作品'}).waitFor();
    assert.equal(requests.length,1);
   }
  }else {
   await page.getByRole('heading',{name:'確認作品'}).waitFor();
   assert.equal(requests.length,1);
   if(scenario==='lost-after-save')assert.ok(statusCalls>=2);
  }
  if(!['old-server','status-unavailable'].includes(scenario))assert.equal(await page.evaluate(()=>localStorage.getItem('aidmath-share-pending-post-t1')),null);
  assert.deepEqual(errors,[]);
  await page.close();console.log('PASS browser:',scenario);
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
