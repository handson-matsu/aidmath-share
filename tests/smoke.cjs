// Run with Node and Playwright installed: NODE_PATH=... node tests/smoke.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const writes = [];
  let accessRequests = 0;
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.accessCalls = [];
    window.fetch = function(input, options) {
      if (String(input).includes('app=aidmath-share')) {
        const request = new Request(input, options);
        window.accessCalls.push({method:request.method,keepalive:request.keepalive,mode:request.mode,cache:request.cache});
      }
      return originalFetch.call(this, input, options);
    };
  });
  let failed = false;
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const posts = [{postId:'p1',title:'三角形の敷き詰め',body:'<img src=x onerror=alert(1)>',displayName:'探究さん',createdAt:'2026-09-28T01:00:00Z'}];
  const comments = [{commentId:'c1',body:'色の組み合わせがきれい！',displayName:'数学さん',createdAt:'2026-09-28T01:00:00Z'}];
  await page.route('https://aidmath.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (!['index.html','style.css','app.js'].includes(file)) return route.fulfill({status:404,body:''});
    await route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(__dirname,'..',file))});
  });
  await page.route('https://script.google.com/**', async route => {
    const request = route.request();
    if (new URL(request.url()).searchParams.get('app') === 'aidmath-share') {
      accessRequests++;
      assert.equal(request.method(), 'GET');
      // Simulate failure while exercising every existing feature below.
      return route.abort('failed');
    }
    const action = new URL(request.url()).searchParams.get('action');
    let result;
    if (failed) result = {ok:false,error:'PRIVATE_SPREADSHEET_ID'};
    else if (request.method() === 'POST') {
      assert.match(request.headers()['content-type'], /^application\/x-www-form-urlencoded/);
      const data = Object.fromEntries(new URLSearchParams(request.postData())); writes.push(data);
      if(action === 'createComment') comments.push({...data,commentId:'c'+(comments.length+1),createdAt:'2026-09-29T01:00:00Z'});
      if(action === 'createPost') posts.push({...data,postId:'p2',createdAt:'2026-09-29T01:00:00Z'});
      result=action === 'requestDeleteV2' ? {ok:true,protocol:'delete-request-v1',state:'saved',requestId:data.requestId} : action === 'createPost' ? {ok:true,protocol:'post-request-v1',state:'saved',requestId:data.requestId,postId:'p2'} : {ok:true};
    } else if(action === 'postStatus') { const requestId=new URL(request.url()).searchParams.get('requestId'); const saved=posts.find(p=>p.requestId===requestId); result={ok:true,protocol:'post-request-v1',requestId,state:saved?'saved':'not_found',...(saved?{postId:saved.postId}:{})}; }
    else if(action === 'deleteRequestStatus') result={ok:true,protocol:'delete-request-v1',state:'not_found',requestId:new URL(request.url()).searchParams.get('requestId')};
    else if(action === 'topics') result={ok:true,topics:[{topicId:'t1',name:'敷き詰めパターン',description:'かたちのつながりを見つけよう'}]};
    else if(action === 'posts') result={ok:true,posts};
    else if(action === 'comments') result={ok:true,comments};
    else if(action === 'image') result={ok:true,hasImage:true,mimeType:'image/png',data:image};
    await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
  });
  await page.goto('https://aidmath.test/');
  await page.getByRole('link',{name:/THEME 01/}).click();
  await page.getByRole('link',{name:/三角形の敷き詰め/}).click();
  await page.getByText('色の組み合わせがきれい！',{exact:true}).waitFor();
  assert.equal(await page.locator('.body-text').first().textContent(),posts[0].body);
  assert.equal(await page.locator('.body-text img').count(),0);
  await page.getByRole('button',{name:'返信',exact:true}).click();
  await page.getByLabel('コメント本文').fill('どうやって作りましたか？');
  await page.getByRole('button',{name:'コメントを投稿',exact:true}).click();
  await page.getByText('どうやって作りましたか？',{exact:true}).waitFor();
  assert.equal(writes[0].replyTo,'c1');
  await page.getByRole('button', {name:'↳ #1 への返信', exact:true}).waitFor();
  const authorId=writes[0].authorId;
  await page.getByRole('button',{name:'削除を申請',exact:true}).last().click();
  await page.getByLabel('申請理由').fill('テスト理由');
  await page.getByRole('button',{name:'申請する',exact:true}).click();
  await page.locator('dialog').waitFor({state:'hidden'});
  assert.equal(writes[1].targetType,'comment');
  assert.equal(writes[1].requesterId,authorId);
  await page.getByRole('link',{name:/作品一覧/}).click();
  await page.getByRole('link',{name:'＋ 作品を投稿する'}).click();
  await page.getByLabel('タイトル').fill('新しいパターン');
  await page.getByLabel('作品画像').setInputFiles({name:'fake.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await page.getByText('画像ファイルの内容を確認できません。別の画像を選んでください。').waitFor();
  await page.getByLabel('作品画像').setInputFiles({name:'pattern.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.locator('.preview').waitFor({state:'visible'});
  await page.getByRole('button',{name:'作品を投稿する',exact:true}).click();
  await page.getByRole('heading',{name:'新しいパターン'}).waitFor();
  assert.equal(writes[2].authorId,authorId);
  assert.equal(writes[2].imageData,image);
  assert.equal(writes[2].imageType,'image/png');
  await page.waitForFunction(() => [...document.querySelectorAll('.art-frame img')].length === 2 && [...document.querySelectorAll('.art-frame img')].every(img => img.naturalWidth > 0));
  // Deliberately interleaved roots, replies, and a reply to a reply.
  comments.splice(0, comments.length, ...[
    ['a', '', 'コメントA'], ['a1', 'a', 'Aへの返信1'],
    ['b', '', 'コメントB'], ['b1', 'b', 'Bへの返信'],
    ['a2', 'a', 'Aへの返信2'], ['a3', 'a1', '返信への返信'],
    ['orphan', 'missing', '非公開の親への返信'],
    ['cycle1', 'cycle2', '循環1'], ['cycle2', 'cycle1', '循環2']
  ].map(([commentId,replyTo,body], i) => ({commentId,replyTo,body,createdAt:`2026-09-28T01:00:0${i}Z`})));
  await page.getByRole('link',{name:/三角形の敷き詰め/}).click();
  await page.getByText('返信への返信',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.comment-number').allTextContents(), ['#1','#2','#5','#6','#3','#4','#7','#8','#9']);
  assert.equal(await page.locator('#comment-6 .reply-reference').textContent(),'↳ #2 への返信');
  assert.equal(await page.locator('#comment-4 .reply-reference').textContent(),'↳ #3 への返信');
  const indents = await page.locator('.comment.reply').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).marginLeft));
  assert.equal(new Set(indents).size,1);
  await page.locator('#comment-6 .reply-reference').click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'comment-2');
  await page.locator('#comment-5').getByRole('button',{name:'返信',exact:true}).click();
  assert.match(await page.locator('.reply-banner').textContent(),/^#5 /);
  await page.getByLabel('コメント本文').fill('さらに返信');
  await page.getByRole('button',{name:'コメントを投稿',exact:true}).click();
  await page.getByText('さらに返信',{exact:true}).waitFor();
  assert.equal(writes.at(-1).replyTo,'a2');
  assert.deepEqual(await page.locator('.comment-number').allTextContents(), ['#1','#2','#5','#6','#10','#3','#4','#7','#8','#9']);
  assert.equal(await page.locator('#comment-10 .reply-reference').textContent(),'↳ #5 への返信');
  assert.equal(accessRequests,1, 'hash navigation and posting must not record extra visits');
  assert.deepEqual(await page.evaluate(()=>window.accessCalls),[{method:'GET',keepalive:true,mode:'no-cors',cache:'no-store'}]);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/aidmath-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.goto('https://aidmath.test/');
  await page.getByRole('heading',{name:'探究テーマを選ぶ'}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'/tmp/aidmath-desktop.png',fullPage:true});
  failed=true;
  await page.reload();
  await page.getByRole('heading',{name:'テーマを取得できません'}).waitFor();
  assert.equal((await page.locator('body').textContent()).includes('PRIVATE_SPREADSHEET_ID'),false);
  assert.equal(accessRequests,3, 'initial load, next document load, and reload each record once');
  assert.equal(await page.evaluate(()=>window.accessCalls.length),1);
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS: access recording once per load with keepalive, failure isolation, gallery, safe text, replies, deletion requests, image validation, posting, persistent ID, mobile layout, private error filtering');
})().catch(error=>{console.error(error);process.exit(1)});
