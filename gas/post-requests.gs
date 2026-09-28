// Replace the existing createPost with these functions. Keep other GAS functions.
// Reserve Posts column J (10) for requestId before deploying.
function postRequestId_(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9-]{20,80}$/.test(id)) throw new Error('投稿リクエストIDが不正です。');
  return id;
}
function findPostRequest_(requestId, authorId) {
  const rows = getSheet('Posts').getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][9] || '') !== requestId) continue;
    if (String(rows[i][2]) !== authorId) throw new Error('投稿リクエストを確認できません。');
    return { ok: true, protocol: 'post-request-v1', state: 'saved', requestId: requestId, postId: String(rows[i][0]) };
  }
  return null;
}
function getPostStatus(p) {
  const requestId = postRequestId_(p.requestId);
  const authorId = cleanText(p.authorId, 200);
  if (!authorId) throw new Error('投稿者IDがありません。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, protocol: 'post-request-v1', state: 'processing', requestId: requestId };
  try {
    return findPostRequest_(requestId, authorId) || { ok: true, protocol: 'post-request-v1', state: 'not_found', requestId: requestId };
  } finally { lock.releaseLock(); }
}
function createPost(p) {
  // Keep legacy clients working; their submissions have no idempotency guarantee.
  const requestId = p.requestId ? postRequestId_(p.requestId) : '';
  const authorId = cleanText(p.authorId, 200);
  if (!authorId) throw new Error('投稿者IDがありません。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: true, protocol: 'post-request-v1', state: 'processing', requestId: requestId };
  try {
    const existing = requestId && findPostRequest_(requestId, authorId);
    if (existing) return existing;
    const result = createPostOnce_(p, requestId);
    SpreadsheetApp.flush();
    result.state = 'saved';
    return result;
  } finally { lock.releaseLock(); }
}

function createPostOnce_(p, requestId) {

  const topicId = cleanText(p.topicId, 100);
  const authorId = cleanText(p.authorId, 200);
  const displayName =
    cleanText(p.displayName, 50) || '名無しさん';

  const title = cleanText(p.title, 100);
  const body = cleanText(p.body, 3000);

  if (!topicId) {
    throw new Error('題材が指定されていません。');
  }

  if (!authorId) {
    throw new Error('投稿者IDがありません。');
  }

  // 有効な題材か確認
  const topic = getTopics().find(
    t => t.topicId === topicId
  );

  if (!topic) {
    throw new Error('この題材には投稿できません。');
  }

  const postId = makeId('post');

  let imageFileId = '';

  if (p.imageData) {

    if (!topic.imageEnabled) {
      throw new Error('この題材では画像投稿できません。');
    }

    imageFileId = saveImage(
      postId,
      p.imageData,
      p.imageType
    );
  }

  const sheet = getSheet('Posts');

  sheet.appendRow([
    postId,
    topicId,
    authorId,
    displayName,
    title,
    body,
    imageFileId,
    new Date(),
    'published',
    requestId
  ]);

  return {
    ok: true,
    postId: postId,
    requestId: requestId,
    protocol: 'post-request-v1'
  };
}
