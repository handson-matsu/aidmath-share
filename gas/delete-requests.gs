// Add to the EXISTING PUBLIC GAS project. Keep the legacy requestDelete function.
// See DELETE-REQUESTS-DEPLOY.md for the two additional action routes.
// Uses the existing getSheet(name) helper. No new columns or properties.
function deleteRequestText_(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('削除申請の入力を確認してください。');
  return value.trim();
}
function deleteRequestIdentity_(p) {
  const requestId = deleteRequestText_(p.requestId, 80);
  const requesterId = deleteRequestText_(p.requesterId, 80);
  if (!/^delete_[a-f0-9]{64}$/.test(requestId) || !/^[a-zA-Z0-9-]{20,80}$/.test(requesterId)) throw new Error('削除申請の確認情報が不正です。');
  return { requestId: requestId, requesterId: requesterId };
}
function deleteRequestRows_(name, headers) {
  const sheet = getSheet(name);
  const rows = sheet.getDataRange().getValues();
  if (!rows.length || !headers.every((h, i) => rows[0][i] === h)) throw new Error('削除申請のシート設定を確認してください。');
  const ids = new Set();
  const records = rows.slice(1).filter(row => row.some(v => v !== ''));
  records.forEach(row => {
    if (typeof row[0] !== 'string' || !row[0] || ids.has(row[0])) throw new Error('削除申請の対象IDを確認してください。');
    ids.add(row[0]);
  });
  return { sheet: sheet, records: records };
}
function deleteRequestTable_() {
  return deleteRequestRows_('DeleteRequests', ['requestId', 'targetType', 'targetId', 'requesterId', 'reason', 'createdAt', 'status']);
}
function deleteRequestResult_(id, state) {
  return { ok: true, protocol: 'delete-request-v1', requestId: id, state: state };
}
function deleteRequestExisting_(table, identity) {
  const row = table.records.find(r => r[0] === identity.requestId);
  if (row && row[3] !== identity.requesterId) throw new Error('削除申請を確認できません。');
  return row;
}
function getDeleteRequestStatus(p) {
  const identity = deleteRequestIdentity_(p);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return deleteRequestResult_(identity.requestId, 'processing');
  try {
    const row = deleteRequestExisting_(deleteRequestTable_(), identity);
    // Approval/rejection never removes the idempotency record. Do not expose reason or status.
    return deleteRequestResult_(identity.requestId, row ? 'saved' : 'not_found');
  } finally { lock.releaseLock(); }
}
function validateDeleteRequestTarget_(type, id) {
  const posts = deleteRequestRows_('Posts', ['postId', 'topicId', 'authorId', 'displayName', 'title', 'body', 'imageFileId', 'createdAt', 'status']);
  let postId = id;
  if (type === 'comment') {
    const comments = deleteRequestRows_('Comments', ['commentId', 'postId', 'authorId', 'displayName', 'body', 'replyTo', 'createdAt', 'status']);
    const comment = comments.records.find(r => r[0] === id && r[7] === 'published');
    if (!comment) throw new Error('申請対象を確認できません。');
    postId = comment[1];
  }
  if (!posts.records.some(r => r[0] === postId && r[8] === 'published')) throw new Error('申請対象を確認できません。');
}
function requestDeleteWithId(p) {
  const identity = deleteRequestIdentity_(p);
  const type = p.targetType, targetId = deleteRequestText_(p.targetId, 200), reason = deleteRequestText_(p.reason, 2000);
  if (['post', 'comment'].indexOf(type) === -1 || !/^[a-zA-Z0-9_-]+$/.test(targetId) || reason.startsWith('=')) throw new Error('削除申請の入力を確認してください。');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return deleteRequestResult_(identity.requestId, 'processing');
  try {
    const table = deleteRequestTable_();
    const existing = deleteRequestExisting_(table, identity);
    if (existing) {
      if (existing[1] !== type || existing[2] !== targetId || existing[4] !== reason) throw new Error('同じ申請IDの内容を変更できません。');
      return deleteRequestResult_(identity.requestId, 'saved');
    }
    validateDeleteRequestTarget_(type, targetId);
    table.sheet.appendRow([identity.requestId, type, targetId, identity.requesterId, reason, new Date(), 'pending']);
    SpreadsheetApp.flush();
    return deleteRequestResult_(identity.requestId, 'saved');
  } finally { lock.releaseLock(); }
}
