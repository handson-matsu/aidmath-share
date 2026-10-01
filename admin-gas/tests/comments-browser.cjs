const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=require('./moderation-fixture.cjs');
(async()=>{
 const f=fixture();f.rows.Comments.length=1;
 for(let i=1;i<=10003;i++)f.rows.Comments.push(['c'+i,['p1','p2','p3','missing'][i%4],'a','n','body'+i,'',new Date(),['published','hidden','deleted'][i%3],'keep']);
 const errors=[],calls=[];let fail=false;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.exposeFunction('rpc',async(method,payload)=>{calls.push({method,payload});if(fail)throw Error('network');return f.call(method,payload);});
 await page.addInitScript(()=>{function run(success,failure){const r={withSuccessHandler:f=>run(f,failure),withFailureHandler:f=>run(success,f)};for(const m of ['adminListTopics','adminListComments','adminSetCommentStatus'])r[m]=p=>window.rpc(m,p).then(success,failure);return r;}window.google={script:{run:run()}};});
 const root=path.join(__dirname,'..');const html=fs.readFileSync(path.join(root,'Index.html'),'utf8').replace("<?!= include_('Styles'); ?>",fs.readFileSync(path.join(root,'Styles.html'),'utf8')).replace("<?!= include_('App'); ?>",fs.readFileSync(path.join(root,'App.html'),'utf8'));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='admin.test'?r.fulfill({contentType:'text/html',body:html}):r.abort());await page.goto('https://admin.test/');
 await page.getByRole('heading',{name:/敷き詰め/}).waitFor();await page.getByRole('button',{name:'コメント管理',exact:true}).click();
 const ready=()=>page.waitForFunction(()=>!document.getElementById('moderation-reload').disabled);
 const ids=()=>page.locator('.moderation-card > .meta').allTextContents().then(a=>a.filter(x=>x.startsWith('ID: ')).map(x=>x.slice(4)));
 const card=id=>page.locator('.moderation-card').filter({has:page.getByText('ID: '+id,{exact:true})});
 await ready();assert.deepEqual(await ids(),Array.from({length:50},(_,i)=>'c'+(10003-i)));
 const first=await ids();await page.getByRole('button',{name:'次の50件'}).click();await ready();const second=await ids();assert.equal(second[0],'c9953');assert.ok(second.every(x=>!first.includes(x)));
 await page.getByRole('button',{name:'前の50件'}).click();await ready();assert.deepEqual(await ids(),first);
 for(const status of ['all','published','hidden','deleted'])for(const parent of ['all','published','hidden','deleted','unknown']){
  await page.locator('#comment-filter').selectOption(status);await ready();await page.locator('#comment-post-filter').selectOption(parent);await ready();
  assert.match(await page.locator('#comment-page').innerText(),/^1ページ/);
  const expected=f.rows.Comments.slice(1).filter(r=>(status==='all'||r[7]===status)&&(parent==='all'||({p1:'published',p2:'hidden',p3:'deleted'}[r[1]]||'unknown')===parent)).reverse().slice(0,50).map(r=>r[0]);
  assert.deepEqual(await ids(),expected);
 }
 // Retain page and filters; removing a match fills the page from older rows.
 await page.locator('#comment-filter').selectOption('published');await ready();await page.locator('#comment-post-filter').selectOption('published');await ready();
 await page.getByRole('button',{name:'次の50件'}).click();await ready();let before=await ids();
 await card(before[0]).getByRole('button',{name:'非公開にする'}).click();await ready();
 assert.match(await page.locator('#comment-page').innerText(),/^2ページ/);assert.equal(await page.locator('#comment-filter').inputValue(),'published');assert.equal(await page.locator('#comment-post-filter').inputValue(),'published');
 const after=await ids();assert.equal(after.length,50);assert.deepEqual(after.slice(0,49),before.slice(1));
 // Parent restrictions in the UI; hidden and deleted comments remain readable.
 for(const parent of ['hidden','deleted','unknown']){
  await page.locator('#comment-filter').selectOption('hidden');await ready();await page.locator('#comment-post-filter').selectOption(parent);await ready();
  assert.equal(await page.getByRole('button',{name:'公開に戻す',exact:true}).count(),0);
  assert.ok(await page.getByRole('button',{name:'削除する',exact:true}).count()>0);
 }
 // Empty last page after update falls back to the previous anchor.
 f.rows.Comments.length=1;for(let i=1;i<=51;i++)f.rows.Comments.push(['z'+i,'p1','','','z'+i,'',new Date(),'published']);
 await page.locator('#comment-filter').selectOption('published');await ready();await page.locator('#comment-post-filter').selectOption('published');await ready();
 await page.getByRole('button',{name:'次の50件'}).click();await ready();assert.deepEqual(await ids(),['z1']);
 await card('z1').getByRole('button',{name:'非公開にする'}).click();await ready();assert.match(await page.locator('#comment-page').innerText(),/^1ページ/);assert.equal((await ids()).length,50);
 // No matches after an otherwise full page: do not navigate to an empty page.
 await page.getByRole('button',{name:'次の50件'}).click();await ready();assert.equal((await ids()).length,50);assert.match(await page.locator('#moderation-message').innerText(),/これ以降/);
 // Pagination errors clear stale buttons; reload recovers with the same filters.
 fail=true;await page.locator('#moderation-reload').click();await ready();assert.equal((await ids()).length,0);
 fail=false;await page.locator('#moderation-reload').click();await ready();assert.equal((await ids()).length,50);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/tmp/aidmath-comment-pages.png',fullPage:false});assert.deepEqual(errors,[]);
 assert.ok(calls.filter(c=>c.method==='adminListComments').every(c=>c.payload&&'status'in c.payload));
 console.log('PASS browser 10,003 comments: 50-item next/previous, 20 filters, reset, page retention/refill, parent restrictions, empty-page fallback, errors/recovery, mobile');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
