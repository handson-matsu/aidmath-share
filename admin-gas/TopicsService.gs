const TOPIC_HEADERS_ = ['topicId', 'title', 'description', 'imageEnabled', 'commentEnabled', 'isActive'];
function topicSheet_(config) {
  const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName('Topics');
  if (!sheet || sheet.getLastColumn() < 6) adminFail_('SCHEMA', 'TopicsのA〜F列を確認してください。自動変更は行いません。');
  const headers = sheet.getRange(1, 1, 1, 6).getValues()[0];
  if (!TOPIC_HEADERS_.every((name, i) => headers[i] === name)) adminFail_('SCHEMA', 'Topicsの列見出しが想定と異なります。自動変更は行いません。');
  return sheet;
}
function topicRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  const ids = new Set();
  return values.map((row, i) => {
    if (row.every(value => value === '')) return null;
    if (typeof row[0] !== 'string' || !row[0] || ids.has(row[0]) ||
        typeof row[1] !== 'string' || typeof row[2] !== 'string' ||
        !row.slice(3, 6).every(value => typeof value === 'boolean')) {
      adminFail_('SCHEMA', 'TopicsにID重複・空ID・不正な値があります。IDと真偽値を確認してください。');
    }
    ids.add(row[0]);
    return { rowNumber: i + 2, values: row };
  }).filter(Boolean);
}
function topicRevision_(row) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(row), Utilities.Charset.UTF_8));
}
function topicDto_(record) {
  const row = record.values;
  return { topicId: row[0], title: row[1], description: row[2], imageEnabled: row[3], commentEnabled: row[4], isActive: row[5], revision: topicRevision_(row), protected: row[0] === 'tiling' };
}
function topicText_(value, max, required) {
  if (typeof value !== 'string') adminFail_('VALIDATION', '入力値の形式を確認してください。');
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text) || text.startsWith('=')) {
    adminFail_('VALIDATION', '未入力・文字数超過・使用できない文字がないか確認してください。先頭が「=」の文章は保存できません。');
  }
  return text;
}
function topicInput_(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => allowed.indexOf(key) === -1)) {
    adminFail_('VALIDATION', '変更できない項目が含まれています。画面を再読み込みしてください。');
  }
}
function withTopicLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) adminFail_('BUSY', '別の保存処理が実行中です。少し待ってから再操作してください。');
  try { return callback(); } finally { lock.releaseLock(); }
}
function adminListTopics() {
  return adminCall_(config => topicRows_(topicSheet_(config)).map(topicDto_));
}
function adminCreateTopic(input) {
  return adminCall_(config => withTopicLock_(() => {
    topicInput_(input, ['topicId', 'title', 'description']);
    const id = topicText_(input.topicId, 80, true);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || id === 'tiling') adminFail_('VALIDATION', 'IDは小文字英字で始まる半角英数字・ハイフン・アンダースコアにしてください。tilingは予約済みです。');
    const title = topicText_(input.title, 100, true);
    const description = topicText_(input.description, 3000, false);
    const sheet = topicSheet_(config);
    if (topicRows_(sheet).some(record => record.values[0] === id)) adminFail_('DUPLICATE', 'このIDは既に存在します。再送の場合は一覧から保存結果を確認してください。');
    const row = [id, title, description, true, true, false];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 6).setValues([row]);
    SpreadsheetApp.flush();
    return topicDto_({ values: row });
  }));
}
function adminUpdateTopic(input) {
  return adminCall_(config => withTopicLock_(() => {
    topicInput_(input, ['topicId', 'title', 'description', 'isActive', 'revision']);
    const id = topicText_(input.topicId, 200, true);
    if (id === 'tiling') adminFail_('PROTECTED', '既存テーマ「tiling」は今回の管理画面では変更できません。');
    const title = topicText_(input.title, 100, true);
    const description = topicText_(input.description, 3000, false);
    if (typeof input.isActive !== 'boolean' || typeof input.revision !== 'string') adminFail_('VALIDATION', '公開状態または更新情報が不正です。');
    const sheet = topicSheet_(config);
    const record = topicRows_(sheet).find(item => item.values[0] === id);
    if (!record) adminFail_('NOT_FOUND', 'テーマが見つかりません。');
    if (topicRevision_(record.values) !== input.revision) adminFail_('CONFLICT', '別の画面で更新されています。一覧を再読み込みしてから編集してください。');
    const row = record.values.slice();
    row[1] = title; row[2] = description; row[5] = input.isActive;
    // Never write the ID; retain image/comment booleans and all columns after F.
    sheet.getRange(record.rowNumber, 2, 1, 5).setValues([row.slice(1)]);
    SpreadsheetApp.flush();
    return topicDto_({ values: row });
  }));
}
