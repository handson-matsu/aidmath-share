const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const fixture = require('./moderation-fixture.cjs');
(async () => {
 const f=fixture(), calls=[], errors=[];
 let fail=false;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('rpc',async (method,payload)=>{
   calls.push(method); await new Promise(r=>setTimeout(r,50));
   if(fail)throw Error('simulated network error');
   return f.call(method,payload);
  });
  await page.addInitScript(()=>{
   function runner(success,failure) {
    const run={withSuccessHandler:fn=>runner(fn,failure),withFailureHandler:fn=>runner(success,fn)};
    for(const method of ['adminListTopics','adminCreateTopic','adminUpdateTopic','adminListPosts','adminSetPostStatus','adminListComments','adminSetCommentStatus','adminListDeleteRequests','adminResolveDeleteRequest'])run[method]=p=>window.rpc(method,p).then(success,failure);
    return run;
   }
   window.google={script:{run:runner()}};
  });
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'Index.html'),'utf8').replace("<?!= include_('Styles'); ?>",fs.readFileSync(path.join(root,'Styles.html'),'utf8')).replace("<?!= include_('App'); ?>",fs.readFileSync(path.join(root,'App.html'),'utf8'));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='admin.test'?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await page.goto('https://admin.test/');
  await page.getByRole('heading',{name:/敷き詰め/}).waitFor();
  const nav=name=>page.getByRole('button',{name,exact:true});
  const card=id=>page.locator('.moderation-card').filter({has:page.getByText('ID: '+id,{exact:true})});
  const done=()=>page.getByText('処理が完了しました。公開画面は再読み込み後に反映されます。',{exact:true}).waitFor();
  await nav('作品管理').click(); await card('p1').waitFor();
  assert.equal(await page.locator('.description img').count(),0);
  assert.equal(await card('p3').locator('button').count(),0);
  page.once('dialog',d=>d.dismiss()); await card('p1').getByRole('button',{name:'削除する',exact:true}).click();
  assert.equal(f.rows.Posts[1][8],'published');
  page.on('dialog',d=>d.accept());
  // Synchronous double click still produces only one RPC.
  await card('p1').getByRole('button',{name:'非公開にする'}).evaluate(b=>{b.click();b.click();}); await done();
  assert.equal(calls.filter(x=>x==='adminSetPostStatus').length,1);
  await card('p1').getByRole('button',{name:'公開に戻す'}).click();await done();
  await card('p2').getByRole('button',{name:'削除する',exact:true}).click();await done();assert.equal(f.rows.Posts[2][8],'deleted');
  await nav('コメント管理').click(); await card('c1').waitFor();
  await card('c1').getByRole('button',{name:'非公開にする'}).click(); await done();assert.equal(f.rows.Comments[2][7],'published');
  await card('c1').getByRole('button',{name:'公開に戻す'}).click(); await done();
  await card('c3').getByRole('button',{name:'削除する',exact:true}).click(); await done();
  assert.equal(await card('c3').locator('button').count(),0);
  await nav('削除申請管理').click(); await card('r1').waitFor();
  await card('r1').getByRole('button',{name:'承認して削除'}).evaluate(b=>{b.click();b.click();});await done();
  assert.equal(f.rows.Posts[1][8],'deleted');assert.equal(f.rows.DeleteRequests[1][6],'approved');assert.equal(await card('r1').count(),0);
  await card('r2').getByRole('button',{name:'承認して削除'}).click();await done();assert.equal(f.rows.Comments[1][7],'deleted');assert.equal(f.rows.Comments[2][7],'published');
  await card('r3').getByRole('button',{name:'却下',exact:true}).click();await done();assert.equal(f.rows.Comments[2][7],'published');
  await page.getByLabel('申請の表示').selectOption('all');assert.equal(await card('r1').locator('button').count(),0);assert.equal(await card('r3').locator('button').count(),0);
  await page.setViewportSize({width:390,height:844});
  for(const name of ['作品管理','コメント管理','削除申請管理']) {
   await nav(name).click();await page.waitForFunction(()=>!document.getElementById('moderation-reload').disabled);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);
  }
  await page.getByLabel('申請の表示').selectOption('all');
  await page.screenshot({path:'/tmp/aidmath-admin-moderation.png',fullPage:true});
  await nav('作品管理').click();await card('p1').waitFor();
  fail=true;await nav('再読み込み').click();await page.getByText(/通信結果を確認できません/).waitFor();assert.equal(await page.locator('.moderation-card').count(),0);
  fail=false;await nav('再読み込み').click();await card('p1').waitFor();
  await nav('コメント管理').click();await card('c2').waitFor();
  fail=true;await card('c2').getByRole('button',{name:'非公開にする'}).click();await page.getByText(/保存済みの可能性があります/).waitFor();assert.equal(await page.locator('.moderation-card').count(),0);
  fail=false;await nav('再読み込み').click();await card('c2').waitFor();
  await nav('テーマ管理').click();await page.getByRole('heading',{name:/敷き詰め/}).waitFor();assert.equal(await page.locator('#list button').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS browser: navigation, all moderation actions, confirmation cancel, duplicate clicks, safe text, pending filter, completed requests, errors/recovery, mobile, theme preservation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
