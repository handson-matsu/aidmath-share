const {chromium}=require('playwright');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 let topics=[{topicId:'tiling',title:'敷き詰めパターン',description:'既存',imageEnabled:true,commentEnabled:true,isActive:true,protected:true,revision:'r0'}];
 window.calls=[];
 function runner(success,failure){return {withSuccessHandler:fn=>runner(fn,failure),withFailureHandler:fn=>runner(success,fn),adminListTopics:()=>setTimeout(()=>success({ok:true,data:structuredClone(topics)}),0),adminCreateTopic:p=>{window.calls.push(['create',p]);setTimeout(()=>{if(topics.some(t=>t.topicId===p.topicId))return success({ok:false,error:{message:'このIDは既に存在します。'}});const t={...p,imageEnabled:true,commentEnabled:true,isActive:false,revision:'r1'};topics.push(t);success({ok:true,data:t});},100);},adminUpdateTopic:p=>{window.calls.push(['update',p]);setTimeout(()=>{const t=topics.find(t=>t.topicId===p.topicId);Object.assign(t,p,{revision:'r2'});success({ok:true,data:t});},100);}};}
 window.google={script:{run:runner()}};
});
const html=fs.readFileSync(path.join(root,'Index.html'),'utf8').replace("<?!= include_('Styles'); ?>",fs.readFileSync(path.join(root,'Styles.html'),'utf8')).replace("<?!= include_('App'); ?>",fs.readFileSync(path.join(root,'App.html'),'utf8'));
await page.route('https://admin.test/**',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto('https://admin.test/');await page.getByText('敷き詰めパターン',{exact:false}).waitFor();assert.equal(await page.locator('#list button').count(),0);
await page.getByRole('button',{name:'テーマを追加'}).click();assert.equal(await page.locator('#topic-active').isDisabled(),true);
await page.getByLabel('テーマID',{exact:true}).fill('new-theme');await page.getByLabel('テーマ名',{exact:true}).fill('追加テーマ');await page.getByLabel('説明',{exact:true}).fill('<img src=x onerror=alert(1)>');
await page.locator('form').evaluate(f=>{f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
await page.locator('dialog').waitFor({state:'hidden'});await page.getByRole('heading',{name:/追加テーマ\s*非公開/}).waitFor();assert.equal(await page.locator('.description img').count(),0);assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='create').length),1);
await page.getByRole('button',{name:'編集・公開状態を変更'}).click();assert.equal(await page.locator('#topic-id').isDisabled(),true);await page.locator('#topic-active').check();page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByRole('heading',{name:/^追加テーマ\s*公開$/}).waitFor();
await page.getByRole('button',{name:'編集・公開状態を変更'}).click();await page.locator('#topic-active').uncheck();await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByRole('heading',{name:/追加テーマ\s*非公開/}).waitFor();
const calls=await page.evaluate(()=>window.calls);assert.ok(calls.every(c=>!('imageEnabled'in c[1])&&!('commentEnabled'in c[1])));
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/tmp/aidmath-admin-topics.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS browser: protected tiling, create defaults, double-submit guard, edit immutable ID, publish/unpublish, safe text, fixed flags, mobile');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
