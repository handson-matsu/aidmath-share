'use strict';

const API_URL = 'https://script.google.com/macros/s/AKfycbwQBCg6r_ultfJiS_eaa4zrpxPNoihlOiaBnUQHsambZ06rDEW8YMyKv_iEeE6_AJiA6Q/exec';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const main = document.querySelector('#main');
let generation = 0;
let readController;
let topicsCache;
let deleteTarget;
let noticeTimer;
const objectURLs = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function link(text, href, className) {
  const node = el('a', className, text);
  node.href = href;
  return node;
}
function button(text, fn, className = 'text-button') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', fn);
  return node;
}
function notify(message) {
  clearTimeout(noticeTimer);
  document.querySelector('#notice').textContent = message;
  noticeTimer = setTimeout(() => { document.querySelector('#notice').textContent = ''; }, 6000);
}
function anonymousId() {
  const key = 'aidmath-share-author-id';
  try {
    let id = localStorage.getItem(key);
    if (!id || !/^[a-zA-Z0-9-]{20,80}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(24)), v => v.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    throw new Error('投稿にはブラウザの保存機能が必要です。サイトのストレージ設定を確認してください。');
  }
}
try { anonymousId(); } catch { /* Browsing remains available when storage is disabled. */ }

// GAS reads POST fields from e.parameter. URLSearchParams uses a CORS-safelisted form encoding.
async function api(action, params = {}, signal) {
  const write = ['createPost', 'createComment', 'requestDelete', 'requestDeleteV2'].includes(action);
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  if (!write) Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  let failureKind = 'network';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, write ? 90000 : 30000);
  try {
    const response = await fetch(url, {
      method: write ? 'POST' : 'GET',
      ...(write ? { body: new URLSearchParams({ action, ...params }) } : {}),
      signal: controller.signal, credentials: 'omit', redirect: 'follow'
    });
    failureKind = 'http';
    if (!response.ok) throw new Error('http');
    failureKind = 'json';
    const result = await response.json();
    failureKind = 'api';
    if (!result || result.ok === false || result.success === false || result.error) throw new Error('api');
    failureKind = 'unconfirmed';
    if (write && result.ok !== true && result.success !== true) throw new Error('unconfirmed');
    // Image responses use data for base64, not for a response envelope.
    return action === 'image' ? result : (result.data ?? result);
  } catch {
    // Never display server diagnostics: these can contain spreadsheet or Drive identifiers.
    const error = new Error(write
      ? '送信結果を確認できませんでした。送信済みの可能性があるため、一覧を確認してから再操作してください。'
      : 'データを読み込めませんでした。通信環境を確認し、時間をおいて再読み込みしてください。解決しない場合は管理者にお知らせください。');
    error.kind = timedOut ? 'timeout' : controller.signal.aborted ? 'aborted' : failureKind;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
function collection(result, key) {
  const values = Array.isArray(result) ? result : result?.[key];
  if (!Array.isArray(values)) throw new Error('データの形式を確認できませんでした。管理者にお知らせください。');
  return values.filter(v => v && typeof v === 'object');
}
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function topicRecord(raw) { return { id: text(raw.topicId ?? raw.id), name: text(raw.name ?? raw.title ?? raw.topicName), description: text(raw.description) }; }
function postRecord(raw) { return { id: text(raw.postId ?? raw.id), name: text(raw.displayName ?? raw.authorName), title: text(raw.title), body: text(raw.body ?? raw.description ?? raw.content), createdAt: text(raw.createdAt ?? raw.timestamp) }; }
function commentRecord(raw) { return { id: text(raw.commentId ?? raw.id), parentId: text(raw.replyTo ?? raw.parentCommentId ?? raw.parentId), name: text(raw.displayName ?? raw.authorName), body: text(raw.body ?? raw.content ?? raw.comment), createdAt: text(raw.createdAt ?? raw.timestamp) }; }
// Input remains chronological so numbering and order within each group stay stable.
function groupComments(comments) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const groups = new Map();
  const ungrouped = [];
  comments.filter(comment => !comment.parentId).forEach(comment => groups.set(comment.id, [comment]));
  for (const comment of comments) {
    if (!comment.parentId) continue;
    let ancestor = comment;
    const visited = new Set();
    while (ancestor?.parentId && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      ancestor = byId.get(ancestor.parentId);
    }
    if (ancestor && !ancestor.parentId) groups.get(ancestor.id).push(comment);
    else ungrouped.push(comment); // Keep missing-parent and cyclic records visible.
  }
  return [...groups.values()].flat().concat(ungrouped);
}
function dateNumber(value) { const n = Date.parse(value); return Number.isFinite(n) ? n : 0; }
function dateLabel(value) { return dateNumber(value) ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '日時不明'; }
function metadata(record) {
  const node = el('div', 'meta');
  node.append(el('span', '', record.name || '匿名さん'), el('span', '', dateLabel(record.createdAt)));
  return node;
}
const topicURL = id => '#topic/' + encodeURIComponent(id);
const postURL = (topicId, postId) => topicURL(topicId) + '/post/' + encodeURIComponent(postId);
function state(container, title, message, retry) {
  const box = el('div', 'state');
  box.append(el('h2', '', title), el('p', '', message));
  if (retry) box.append(button('再読み込み', retry, 'secondary'));
  container.replaceChildren(box);
}
async function getTopics(signal) {
  if (!topicsCache) topicsCache = collection(await api('topics', {}, signal), 'topics').map(topicRecord).filter(t => t.id);
  return topicsCache;
}

// Image endpoints must return base64 JSON. Never render arbitrary remote URLs or Drive IDs.
async function loadImage(frame, postId, title, signal) {
  try {
    const result = await api('image', { postId }, signal);
    let mime = text(result.mimeType);
    let base64 = text(result.data ?? result.base64 ?? result.imageBase64);
    const dataURL = text(result.dataUrl ?? result.imageDataUrl);
    if (dataURL) {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataURL);
      if (!match) throw new Error('invalid image');
      [, mime, base64] = match;
    }
    if (!IMAGE_TYPES.has(mime) || !base64 || base64.length > MAX_IMAGE_BYTES * 1.4) throw new Error('invalid image');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes.length > MAX_IMAGE_BYTES || !validSignature(bytes, mime)) throw new Error('invalid image');
    if (signal?.aborted || !frame.isConnected) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    objectURLs.add(url);
    const img = el('img');
    img.alt = title || '投稿作品';
    img.onload = () => { URL.revokeObjectURL(url); objectURLs.delete(url); };
    img.onerror = () => { URL.revokeObjectURL(url); objectURLs.delete(url); frame.replaceChildren(el('span', '', '画像を表示できません')); };
    img.src = url;
    frame.replaceChildren(img);
  } catch {
    if (!signal?.aborted) frame.replaceChildren(el('span', '', '画像を読み込めませんでした'), button('再試行', () => loadImage(frame, postId, title, signal)));
  }
}
function imageFrame() { return el('div', 'art-frame', '画像を読み込み中…'); }
function validSignature(b, mime) {
  if (mime === 'image/jpeg') return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v);
  return b.length > 12 && String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP';
}
async function home(signal, token) {
  document.title = 'AidMath-Share | 数学の発見を、分かち合おう。';
  const hero = el('section', 'hero');
  const copy = el('div');
  copy.append(el('div', 'eyebrow', 'EXPLORE · CREATE · SHARE'), el('h1', '', '数学の発見を、\n分かち合おう。'), el('p', '', 'かたちの不思議、パターンの美しさ。あなたの探究を作品にして、みんなの視点で、もっと広げよう。'));
  const pattern = el('div', 'pattern'); pattern.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 12; i++) pattern.append(el('span'));
  hero.append(copy, pattern);
  const heading = el('div', 'section-heading');
  heading.append(el('h2', '', '探究テーマを選ぶ'), el('p', '', '気になるテーマから、作品を見にいこう'));
  const list = el('div', 'grid');
  main.replaceChildren(hero, heading, list);
  list.textContent = 'テーマを読み込み中…';
  try {
    const topics = await getTopics(signal);
    if (token !== generation) return;
    list.replaceChildren();
    if (!topics.length) { state(list, 'テーマは準備中です', '公開されるまで、もうしばらくお待ちください。'); return; }
    topics.forEach((topic, i) => {
      const card = el('article', 'card topic-card');
      const a = link('', topicURL(topic.id), 'card-link');
      const body = el('div', 'card-body');
      body.append(el('div', 'topic-number', 'THEME ' + String(i + 1).padStart(2, '0')), el('h3', '', topic.name), el('p', '', topic.description), el('span', 'topic-arrow', '作品ギャラリーへ →'));
      a.append(body); card.append(a); list.append(card);
    });
  } catch (error) { if (token === generation) state(list, 'テーマを取得できません', error.message, route); }
}
async function gallery(topic, signal, token) {
  main.append(link('← テーマ一覧', '#', 'back'));
  const heading = el('div', 'page-heading');
  heading.append(el('h1', '', topic.name), link('＋ 作品を投稿する', topicURL(topic.id) + '/new', 'button'));
  const list = el('div', 'grid');
  main.append(heading, el('p', 'lead', topic.description), list);
  list.textContent = '作品を読み込み中…';
  try {
    const posts = collection(await api('posts', { topicId: topic.id }, signal), 'posts').map(postRecord).filter(p => p.id).sort((a,b) => dateNumber(b.createdAt) - dateNumber(a.createdAt));
    if (token !== generation) return;
    list.replaceChildren();
    if (!posts.length) { state(list, '最初の作品を投稿しよう', 'あなたの発見が、このテーマのはじまりになります。'); return; }
    const images = [];
    posts.forEach(post => {
      const card = el('article', 'card');
      const a = link('', postURL(topic.id, post.id), 'card-link');
      const frame = imageFrame();
      const body = el('div', 'card-body');
      body.append(metadata(post), el('h3', '', post.title || '無題'), el('p', 'clamp', post.body));
      a.append(frame, body); card.append(a); list.append(card);
      images.push({ frame, post });
    });
    // Limit concurrent GAS requests and only fetch images near the viewport.
    const observer = new IntersectionObserver(entries => {
      entries.filter(e => e.isIntersecting).forEach(entry => {
        observer.unobserve(entry.target);
        const item = images.find(i => i.frame === entry.target);
        imageQueue.push(() => loadImage(item.frame, item.post.id, item.post.title, signal));
      });
      pumpImages();
    }, { rootMargin: '200px' });
    images.forEach(i => observer.observe(i.frame));
    signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  } catch (error) { if (token === generation) state(list, '作品を取得できません', error.message, route); }
}
let imageQueue = [];
let activeImages = 0;
function pumpImages() {
  while (activeImages < 3 && imageQueue.length) {
    activeImages++;
    imageQueue.shift()().finally(() => { activeImages--; pumpImages(); });
  }
}
function field(form, labelText, name, { multiline = false, required = false, max = 100, type = 'text' } = {}) {
  const label = el('label', '', labelText);
  const input = el(multiline ? 'textarea' : 'input');
  input.id = 'field-' + name; input.name = name;
  label.htmlFor = input.id;
  label.append(el('span', '', required ? '必須' : '任意'));
  if (!multiline) input.type = type;
  if (type !== 'file') input.maxLength = max;
  input.required = required;
  form.append(label, input);
  return input;
}
function busy(form, value) { form.querySelectorAll('button,input,textarea').forEach(n => { n.disabled = value; }); }
// Pending metadata survives reloads; image data stays only in this tab's memory.
const pendingPostBodies = new Map();
const pendingPostKey = topicId => 'aidmath-share-pending-post-' + encodeURIComponent(topicId);
function readPendingPost(topicId) {
  const raw = localStorage.getItem(pendingPostKey(topicId));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value.requestId || !value.authorId) throw new Error('投稿の確認情報を読み込めません。管理者にご相談ください。');
  return value;
}
async function postStatus(pending) {
  const result = await api('postStatus', { requestId: pending.requestId, authorId: pending.authorId });
  if (result.protocol !== 'post-request-v1' || result.requestId !== pending.requestId || !['saved', 'processing', 'not_found'].includes(result.state)) {
    throw new Error('投稿結果の確認機能がまだ利用できません。管理者にお知らせください。');
  }
  if (result.state === 'saved' && !result.postId) throw new Error('投稿結果を確認できません。');
  return result;
}
async function createPostView(topic, token) {
  const wrap = el('div', 'narrow');
  wrap.append(link('← ' + topic.name + 'の作品一覧', topicURL(topic.id), 'back'), el('h1', '', '作品を投稿する'), el('p', 'lead', '見つけた工夫や不思議を、作品と一緒に伝えよう。'));
  const form = el('form', 'panel');
  const name = field(form, '表示名', 'displayName', { max: 40 }); name.autocomplete = 'nickname'; name.placeholder = '空欄の場合は「匿名さん」';
  const title = field(form, 'タイトル', 'title', { required: true, max: 100 });
  const body = field(form, '説明文', 'body', { multiline: true, max: 5000 });
  const file = field(form, '作品画像', 'image', { required: true, type: 'file' }); file.accept = 'image/jpeg,image/png,image/webp';
  form.append(el('p', 'hint', 'JPEG・PNG・WebP / 5MB以下。個人情報が写っていないか確認してください。'));
  const preview = el('img', 'preview'); preview.alt = '投稿する作品のプレビュー'; preview.hidden = true;
  const error = el('p', 'form-error'); error.setAttribute('role', 'alert');
  const submit = el('button', '', '作品を投稿する'); submit.type = 'submit';
  const actions = el('div', 'actions'); actions.append(submit);
  form.append(preview, error, actions); wrap.append(form); main.append(wrap);
  let image = null;
  let selection = 0;
  file.addEventListener('change', async () => {
    const version = ++selection;
    image = null; preview.hidden = true; preview.removeAttribute('src'); error.textContent = '';
    const selected = file.files[0]; if (!selected) return;
    try {
      if (!IMAGE_TYPES.has(selected.type)) throw new Error('JPEG・PNG・WebPの画像を選んでください。');
      if (selected.size > MAX_IMAGE_BYTES) throw new Error('画像は5MB以下にしてください。');
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (!validSignature(bytes, selected.type)) throw new Error('画像ファイルの内容を確認できません。別の画像を選んでください。');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(selected); });
      const probe = new Image(); probe.src = data; await probe.decode();
      if (version !== selection || token !== generation) return;
      image = { imageType: selected.type, imageData: data.split(',')[1] };
      preview.src = data; preview.hidden = false;
    } catch (err) { if (version === selection) { error.textContent = err.message || '画像を読み込めませんでした。'; file.value = ''; } }
  });
  let pending = null;
  let sending = false;
  let storageError = false;
  const check = button('保存結果を確認する', () => run(false), 'secondary');
  check.hidden = true; actions.prepend(check);
  try { pending = readPendingPost(topic.id); }
  catch { storageError = true; error.textContent = '投稿の確認情報を読み込めません。ブラウザの保存設定を確認してください。'; }
  function setState() {
    busy(form, sending || Boolean(pending) || storageError);
    check.hidden = !pending;
    check.disabled = sending;
    submit.disabled = sending || storageError || Boolean(pending && !pendingPostBodies.has(pending.requestId));
    submit.textContent = sending ? '投稿結果を確認中…' : pending ? '同じ投稿を再確認・再送する' : '作品を投稿する';
  }
  function complete(result) {
    if (!result.postId) return false;
    pendingPostBodies.delete(pending.requestId);
    // Never erase another tab's newer pending request.
    try {
      if (readPendingPost(topic.id)?.requestId === pending.requestId) localStorage.removeItem(pendingPostKey(topic.id));
    } catch { /* A later lookup can still confirm the saved request. */ }
    pending = null;
    if (token === generation) { notify('作品を投稿しました。'); location.hash = topicURL(topic.id); }
    return true;
  }
  async function run(allowSend) {
    if (sending || storageError) return;
    sending = true; error.textContent = ''; setState();
    try {
      if (!pending) {
        // Reuse another tab's pending ID if one was recorded while this form was open.
        pending = readPendingPost(topic.id);
        if (!pending) {
          if (!title.value.trim() || !image) throw new Error('タイトルと画像プレビューを確認してください。');
          pending = { requestId: crypto.randomUUID(), authorId: anonymousId() };
          const payload = { ...pending, topicId: topic.id, displayName: name.value.trim(), title: title.value.trim(), body: body.value.trim(), ...image };
          try { localStorage.setItem(pendingPostKey(topic.id), JSON.stringify(pending)); }
          catch { pending = null; throw new Error('投稿の確認情報を保存できません。ブラウザの保存設定を確認してください。'); }
          pendingPostBodies.set(pending.requestId, payload);
        }
      }
      setState();
      // Require the new GAS protocol before sending: old GAS silently ignores requestId.
      const before = await postStatus(pending);
      if (before.state === 'saved') { complete(before); return; }
      if (allowSend && before.state === 'not_found' && pendingPostBodies.has(pending.requestId)) {
        try {
          const result = await api('createPost', pendingPostBodies.get(pending.requestId));
          if (result.protocol === 'post-request-v1' && result.requestId === pending.requestId && result.state === 'saved' && result.postId) {
            complete(result); return;
          }
        } catch { /* A lost response is not evidence of a failed save. Query before retrying. */ }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        if (token !== generation) return;
        try {
          const status = await postStatus(pending);
          if (status.state === 'saved') { complete(status); return; }
        } catch { /* Keep the pending ID on network errors. */ }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500));
      }
      error.textContent = '投稿結果をまだ確認できません。保存済み・処理中の可能性があります。「保存結果を確認する」を押してください。再送時も同じ投稿IDを使用します。';
      if (!pendingPostBodies.has(pending.requestId)) error.textContent += ' この画面では画像を保持していないため、再送せず結果の確認だけを行います。';
    } catch (err) { error.textContent = err.message; }
    finally { sending = false; setState(); }
  }
  form.addEventListener('submit', event => { event.preventDefault(); run(true); });
  setState();
  if (pending) run(false);

}
function deleteButton(targetType, targetId) { return button('削除を申請', () => openDeleteRequest({ targetType, targetId }), 'text-button danger'); }
async function detail(topic, postId, signal, token) {
  const posts = collection(await api('posts', { topicId: topic.id }, signal), 'posts').map(postRecord);
  if (token !== generation) return;
  const post = posts.find(p => p.id === postId);
  if (!post) { state(main, '作品が見つかりません', '削除されたか、公開されていない可能性があります。'); main.append(link('作品一覧へ戻る', topicURL(topic.id), 'back')); return; }
  const wrap = el('article', 'detail');
  const frame = imageFrame(); frame.classList.add('large');
  wrap.append(link('← ' + topic.name + 'の作品一覧', topicURL(topic.id), 'back'), frame, el('h1', '', post.title || '無題'), metadata(post), el('p', 'body-text', post.body), deleteButton('post', post.id));
  const section = el('section', 'comments');
  section.append(el('h2', '', '作品について話そう'));
  const list = el('div'); const composer = el('form', 'panel');
  section.append(el('p', 'hint', 'すてきだと思ったところや、気になったことを言葉にしてみよう。'), list, composer);
  wrap.append(section); main.replaceChildren(wrap);
  loadImage(frame, post.id, post.title, signal);
  let replyTo = null;
  let comments = [];
  const banner = el('div', 'reply-banner'); banner.hidden = true;
  const replyLabel = el('span');
  banner.append(replyLabel, button('解除', () => { replyTo = null; banner.hidden = true; }));
  composer.append(el('h3', '', 'コメントを書く'), banner);
  const name = field(composer, '表示名', 'displayName', { max: 40 }); name.autocomplete = 'nickname'; name.placeholder = '空欄の場合は「匿名さん」';
  const body = field(composer, 'コメント本文', 'commentBody', { multiline: true, required: true, max: 2000 });
  const error = el('p', 'form-error'); error.setAttribute('role', 'alert');
  const submit = el('button', '', 'コメントを投稿'); submit.type = 'submit';
  const actions = el('div', 'actions'); actions.append(submit); composer.append(error, actions);
  async function refreshComments() {
    list.textContent = 'コメントを読み込み中…';
    try {
      comments = collection(await api('comments', { postId }, signal), 'comments').map(commentRecord).filter(c => c.id).sort((a,b) => dateNumber(a.createdAt) - dateNumber(b.createdAt));
      if (token !== generation) return;
      list.replaceChildren();
      if (!comments.length) { state(list, 'まだコメントはありません', '最初の気づきを伝えてみませんか。'); return; }
      const numbers = new Map(comments.map((c,i) => [c.id, i + 1]));
      groupComments(comments).forEach(comment => {
        const number = numbers.get(comment.id);
        const card = el('article', 'comment' + (comment.parentId ? ' reply' : '')); card.id = 'comment-' + number;
        if (comment.parentId) {
          const parentNumber = numbers.get(comment.parentId);
          if (parentNumber) card.append(button('↳ #' + parentNumber + ' への返信', () => { const parent = document.getElementById('comment-' + parentNumber); parent.tabIndex = -1; parent.focus(); parent.scrollIntoView({ block: 'center', behavior: 'auto' }); }, 'text-button reply-reference'));
          else card.append(el('p', 'reply-reference', '↳ 公開されていないコメントへの返信'));
        }
        const head = el('div', 'comment-head'); head.append(el('span', 'comment-number', '#' + number), metadata(comment));
        const buttons = el('div', 'comment-actions');
        buttons.append(button('返信', () => { replyTo = comment.id; replyLabel.textContent = '#' + number + ' ' + (comment.name || '匿名さん') + ' への返信'; banner.hidden = false; body.focus(); }), deleteButton('comment', comment.id));
        card.append(head, el('p', 'body-text', comment.body), buttons); list.append(card);
      });
    } catch (err) { if (token === generation) state(list, 'コメントを取得できません', err.message, refreshComments); }
  }
  composer.addEventListener('submit', async event => {
    event.preventDefault(); error.textContent = '';
    if (!body.value.trim()) { error.textContent = 'コメント本文を入力してください。'; body.focus(); return; }
    busy(composer, true); submit.textContent = '投稿中…';
    try {
      await api('createComment', { postId, authorId: anonymousId(), displayName: name.value.trim(), body: body.value.trim(), replyTo: replyTo || '' });
      if (token !== generation) return;
      body.value = ''; replyTo = null; banner.hidden = true; notify('コメントを投稿しました。'); await refreshComments();
    } catch (err) { error.textContent = err.message; }
    finally { busy(composer, false); submit.textContent = 'コメントを投稿'; }
  });
  await refreshComments();
}
const deleteDialog = document.querySelector('#delete-dialog');
const deleteForm = document.querySelector('#delete-form');
const deleteCheck = document.querySelector('#delete-check');
const deleteSubmit = deleteForm.querySelector('[type="submit"]');
const deleteMessage = document.querySelector('#delete-result');
const deleteStoragePrefix = 'aidmath-share-delete-request-';
let deleting = false;
let pendingDelete = null;
let deleteStorageError = false;
const deleteKey = target => deleteStoragePrefix + target.targetType + '-' + encodeURIComponent(target.targetId);
function readDeleteRequest(target) {
  const raw = localStorage.getItem(deleteKey(target));
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (!['post', 'comment'].includes(p.targetType) || typeof p.targetId !== 'string' || !p.targetId || !/^delete_[a-f0-9]{64}$/.test(p.requestId) || !/^[a-zA-Z0-9-]{20,80}$/.test(p.requesterId) ||
      p.targetType !== target.targetType || p.targetId !== target.targetId || typeof p.reason !== 'string' || !p.reason.trim() ||
      p.reason.length > 2000 || typeof p.saved !== 'boolean') throw new Error('storage');
  return p;
}
function deleteControls() {
  busy(deleteForm, deleting);
  deleteForm.elements.reason.disabled = deleting || Boolean(pendingDelete) || deleteStorageError;
  deleteSubmit.disabled = deleting || deleteStorageError || Boolean(pendingDelete?.saved);
  deleteSubmit.textContent = deleting ? '申請結果を確認中…' : pendingDelete ? '同じ申請を再確認・再送する' : '申請する';
  deleteCheck.hidden = !pendingDelete || pendingDelete.saved;
  deleteCheck.disabled = deleting || deleteStorageError;
}
function renderPendingDeletes() {
  const list = document.querySelector('#pending-deletes');
  list.replaceChildren();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(deleteStoragePrefix)) continue;
      const raw = JSON.parse(localStorage.getItem(key));
      const p = readDeleteRequest(raw);
      if (p && !p.saved) list.append(button((p.targetType === 'post' ? '作品' : 'コメント') + 'の未確認の削除申請を確認する', () => openDeleteRequest(p), 'secondary'));
    }
  } catch { list.append(el('p', '', '削除申請の確認情報を読み込めません。保存データを消さず管理者にご相談ください。')); }
}
function openDeleteRequest(target) {
  if (deleting || deleteDialog.open) return;
  deleteTarget = { targetType: target.targetType, targetId: target.targetId };
  pendingDelete = null; deleteStorageError = false;
  deleteForm.reset(); deleteForm.querySelector('.form-error').textContent = ''; deleteMessage.textContent = '';
  try {
    pendingDelete = readDeleteRequest(deleteTarget);
    if (pendingDelete) deleteForm.elements.reason.value = pendingDelete.reason;
  } catch {
    deleteStorageError = true;
    deleteForm.querySelector('.form-error').textContent = '削除申請の確認情報を読み込めません。保存データを消さず管理者にご相談ください。';
  }
  deleteControls(); deleteDialog.showModal();
  if (pendingDelete?.saved) deleteMessage.textContent = 'この対象の削除申請は送信済みです。管理者が確認します。';
  else if (pendingDelete) runDeleteRequest(false);
}
async function deleteRequestStatus(pending) {
  const result = await api('deleteRequestStatus', { requestId: pending.requestId, requesterId: pending.requesterId });
  if (result.protocol !== 'delete-request-v1' || result.requestId !== pending.requestId || !['saved', 'processing', 'not_found'].includes(result.state)) {
    const error = new Error('削除申請の確認機能がまだ利用できません。管理者にお知らせください。');
    error.kind = 'protocol'; throw error;
  }
  return result;
}
function completeDeleteRequest() {
  pendingDelete.saved = true;
  // Keep a receipt so reopening the dialog does not start another request.
  try { localStorage.setItem(deleteKey(pendingDelete), JSON.stringify(pendingDelete)); } catch { /* The same ID remains safe to query/retry. */ }
  renderPendingDeletes(); deleteDialog.close(); notify('削除申請を送信しました。管理者が確認します。');
}
async function runDeleteRequest(allowSend) {
  if (deleting || deleteStorageError || pendingDelete?.saved) return;
  deleting = true; deleteControls();
  const errorBox = deleteForm.querySelector('.form-error'); errorBox.textContent = '';
  deleteMessage.textContent = '削除申請の保存結果を確認中…';
  let lastState = '', failureKind = '';
  try {
    if (!pendingDelete) {
      pendingDelete = readDeleteRequest(deleteTarget);
      if (!pendingDelete) {
        const reason = deleteForm.elements.reason.value.trim();
        if (!reason || reason.length > 2000 || reason.startsWith('=')) {
          deleteMessage.textContent = ''; errorBox.textContent = '申請理由を2000文字以内で入力してください。先頭に「=」は使用できません。'; return;
        }
        const requesterId = anonymousId();
        // Identical submissions from two tabs also get the same ID. This is not authentication.
        const bytes = new TextEncoder().encode(JSON.stringify([requesterId, deleteTarget.targetType, deleteTarget.targetId, reason]));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const requestId = 'delete_' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
        pendingDelete = readDeleteRequest(deleteTarget) || { ...deleteTarget, requesterId, requestId, reason, saved: false };
        localStorage.setItem(deleteKey(pendingDelete), JSON.stringify(pendingDelete));
      }
      deleteForm.elements.reason.value = pendingDelete.reason;
    }
    // Persist before ANY send, including retries; inability to retain the ID must block POST.
    localStorage.setItem(deleteKey(pendingDelete), JSON.stringify(pendingDelete));
    deleteControls(); renderPendingDeletes();
    if (pendingDelete.saved) { completeDeleteRequest(); return; }
    const before = await deleteRequestStatus(pendingDelete);
    lastState = before.state;
    if (lastState === 'saved') { completeDeleteRequest(); return; }
    if (allowSend && lastState === 'not_found') {
      try {
        const { saved, ...payload } = pendingDelete;
        const result = await api('requestDeleteV2', payload);
        if (result.protocol === 'delete-request-v1' && result.requestId === pendingDelete.requestId && result.state === 'saved') {
          completeDeleteRequest(); return;
        }
        if (result.protocol === 'delete-request-v1' && result.requestId === pendingDelete.requestId && result.state === 'processing') lastState = 'processing';
        else failureKind = 'protocol';
      } catch (err) { failureKind = err.kind || 'unknown'; }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const status = await deleteRequestStatus(pendingDelete); lastState = status.state;
        if (lastState === 'saved') { completeDeleteRequest(); return; }
      } catch (err) { lastState = ''; failureKind = err.kind || 'unknown'; }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    deleteMessage.textContent = lastState === 'processing'
      ? '申請の保存確認が処理待ちです。「保存結果を確認する」で確認してください。'
      : lastState === 'not_found'
        ? '現時点では保存を確認できません。遅れて保存される可能性があります。確認を続けるか、同じ申請のまま再確認・再送できます。'
        : '削除申請の保存結果が不明です。保存済みの可能性があります。「保存結果を確認する」で確認してください。';
    if (failureKind) errorBox.textContent = '確認情報：' + failureKind + '。新しい申請は作成せず、同じ申請情報を保持しています。';
  } catch (err) {
    deleteMessage.textContent = '申請情報を保持したまま確認を中断しました。新しい申請として送り直さず、この画面から保存結果を確認してください。';
    errorBox.textContent = err.kind === 'protocol' ? err.message : err.kind
      ? '保存結果を確認できませんでした（確認情報：' + err.kind + '）。'
      : '申請の確認情報を保存・読み込みできません。ブラウザの保存設定を確認し、管理者にご相談ください。';
  } finally { deleting = false; deleteControls(); renderPendingDeletes(); }
}
document.querySelector('#delete-cancel').addEventListener('click', () => { if (!deleting) deleteDialog.close(); });
deleteDialog.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
deleteCheck.addEventListener('click', () => runDeleteRequest(false));
deleteForm.addEventListener('submit', event => { event.preventDefault(); runDeleteRequest(true); });
renderPendingDeletes();
async function route() {
  const token = ++generation;
  readController?.abort(); readController = new AbortController();
  const signal = readController.signal;
  imageQueue = [];
  objectURLs.forEach(url => URL.revokeObjectURL(url)); objectURLs.clear();
  main.replaceChildren(el('p', 'hint', '読み込み中…'));
  main.focus({ preventScroll: true }); window.scrollTo(0,0);
  try {
    const parts = location.hash.slice(1).split('/').map(decodeURIComponent);
    if (!parts[0]) { await home(signal, token); return; }
    if (parts[0] !== 'topic' || !parts[1]) throw new Error('ページが見つかりません。');
    const topics = await getTopics(signal);
    if (token !== generation) return;
    const topic = topics.find(t => t.id === parts[1]);
    if (!topic) throw new Error('テーマが見つかりません。');
    document.title = topic.name + ' | AidMath-Share';
    main.replaceChildren();
    if (parts.length === 2) await gallery(topic, signal, token);
    else if (parts[2] === 'new' && parts.length === 3) await createPostView(topic, token);
    else if (parts[2] === 'post' && parts[3] && parts.length === 4) await detail(topic, parts[3], signal, token);
    else throw new Error('ページが見つかりません。');
  } catch (err) {
    if (token === generation) { state(main, 'ページを表示できません', err instanceof URIError ? 'リンクを確認してください。' : err.message, route); main.append(link('← テーマ一覧へ', '#', 'back')); }
  }
}
window.addEventListener('hashchange', route);
route();

// Record once per document load, independently of hash navigation and the app API.
void fetch('https://script.google.com/macros/s/AKfycbxssCIHsD-N97SHxNC_GN0ihYeC0qy-lb-EY0KmSs6Gnztaph1sITMerLVEnNWOGkYc/exec?app=aidmath-share', {
  method: 'GET',
  mode: 'no-cors',
  credentials: 'omit',
  cache: 'no-store',
  keepalive: true
}).catch(() => { /* Access recording must not interrupt the app or show a message. */ });
