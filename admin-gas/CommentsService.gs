// Comments are append-only: row descending is registration descending.
// No persistent index/cache and no changes to the public API or sheet schema.
function commentSheet_(config, name) {
  const headers = MODERATION_SCHEMAS_[name];
  const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(name);
  if (!sheet || sheet.getLastColumn() < headers.length ||
      !sheet.getRange(1, 1, 1, headers.length).getValues()[0].every((v, i) => v === headers[i])) {
    adminFail_('SCHEMA', name + 'の列見出しを確認してください。');
  }
  return sheet;
}
function commentFindRow_(sheet, id) {
  if (typeof id !== 'string' || !id || sheet.getLastRow() < 2) return null;
  const matches = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(id)
    .matchEntireCell(true).matchCase(true).useRegularExpression(false).findAll();
  if (matches.length > 1) adminFail_('SCHEMA', '対象のIDが重複しています。シートを確認してください。');
  return matches.length ? matches[0].getRow() : null;
}
function commentPostReader_(sheet) {
  const cache = new Map(); // Only for this RPC; never retained between requests.
  return id => {
    if (!cache.has(id)) {
      const row = commentFindRow_(sheet, id);
      const values = row ? sheet.getRange(row, 5, 1, 5).getValues()[0] : null;
      cache.set(id, { title: values ? moderationString_(values[0]) : '作品が見つかりません',
        status: values ? moderationString_(values[4]) : '',
        state: values && moderationKnown_(values[4]) ? values[4] : 'unknown' });
    }
    return cache.get(id);
  };
}
function commentAdminDto_(record, post) {
  const r = record.values;
  return { id: r[0], postId: moderationString_(r[1]), postTitle: post.title,
    postStatus: post.status, postState: post.state, displayName: moderationString_(r[3]),
    body: moderationString_(r[4]), replyTo: moderationString_(r[5]), createdAt: moderationDate_(r[6]),
    status: moderationString_(r[7]), revision: topicRevision_(r) };
}
function adminListComments(input) {
  return adminCall_(config => {
    input = input === undefined ? {} : input;
    topicInput_(input, ['status', 'postStatus', 'snapshotRow', 'startRow']);
    const status = input.status === undefined ? 'all' : input.status;
    const postStatus = input.postStatus === undefined ? 'all' : input.postStatus;
    if (!['all', 'published', 'hidden', 'deleted'].includes(status) ||
        !['all', 'published', 'hidden', 'deleted', 'unknown'].includes(postStatus)) {
      adminFail_('VALIDATION', 'フィルター条件が不正です。');
    }
    const sheet = commentSheet_(config, 'Comments');
    const lastRow = Math.max(1, sheet.getLastRow());
    const snapshotRow = input.snapshotRow === undefined ? lastRow : input.snapshotRow;
    const startRow = input.startRow === undefined ? snapshotRow : input.startRow;
    if (!Number.isSafeInteger(snapshotRow) || snapshotRow < 1 || snapshotRow > lastRow ||
        !Number.isSafeInteger(startRow) || startRow < 1 || startRow > snapshotRow) {
      adminFail_('VALIDATION', 'ページ情報が無効です。フィルターを選び直して先頭から取得してください。');
    }
    const readPost = commentPostReader_(commentSheet_(config, 'Posts'));
    const items = [], ids = new Set();
    let cursor = startRow;
    while (cursor >= 2 && items.length < 50) {
      const first = Math.max(2, cursor - 99);
      const values = sheet.getRange(first, 1, cursor - first + 1, 8).getValues();
      for (let i = values.length - 1; i >= 0; i--) {
        const r = values[i];
        cursor = first + i - 1;
        if (r.every(v => v === '')) continue;
        if (typeof r[0] !== 'string' || !r[0].trim() || ids.has(r[0])) adminFail_('SCHEMA', 'CommentsのIDを確認してください。');
        ids.add(r[0]);
        if (status !== 'all' && r[7] !== status) continue;
        const post = readPost(r[1]);
        if (postStatus !== 'all' && post.state !== postStatus) continue;
        items.push(commentAdminDto_({ values: r }, post));
        if (items.length === 50) break;
      }
    }
    return { items: items, snapshotRow: snapshotRow, startRow: startRow, nextRow: cursor >= 2 ? cursor : null };
  });
}
function adminSetCommentStatus(input) {
  return adminCall_(config => withTopicLock_(() => {
    topicInput_(input, ['id', 'status', 'revision']);
    if (typeof input.id !== 'string' || !input.id || typeof input.revision !== 'string' || !moderationKnown_(input.status)) {
      adminFail_('VALIDATION', '対象ID・状態・更新情報を確認してください。');
    }
    const sheet = commentSheet_(config, 'Comments');
    const rowNumber = commentFindRow_(sheet, input.id);
    if (!rowNumber) adminFail_('NOT_FOUND', 'コメントが見つかりません。');
    const record = { rowNumber: rowNumber, values: sheet.getRange(rowNumber, 1, 1, 8).getValues()[0] };
    const current = record.values[7];
    if (!moderationKnown_(current)) adminFail_('STATUS', '想定外の状態です。シートを確認してください。');
    if (topicRevision_(record.values) !== input.revision) adminFail_('CONFLICT', '別の操作で更新されています。一覧を再読み込みしてください。');
    if (current === 'deleted') adminFail_('STATUS', '削除済みのコメントは変更できません。');
    if (input.status === 'published') {
      const post = commentPostReader_(commentSheet_(config, 'Posts'))(record.values[1]);
      if (post.state !== 'published') adminFail_('PARENT_STATUS', '親作品が公開中でないため、このコメントは再公開できません。');
    }
    if (current !== input.status) moderationWriteStatus_({ sheet: sheet, statusColumn: 8 }, record, input.status);
    return { id: input.id, status: input.status };
  }));
}
