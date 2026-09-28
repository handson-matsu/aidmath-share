// Shared helpers. Only the status cell is ever written by moderation.
const MODERATION_SCHEMAS_ = {
  Posts: ['postId', 'topicId', 'authorId', 'displayName', 'title', 'body', 'imageFileId', 'createdAt', 'status'],
  Comments: ['commentId', 'postId', 'authorId', 'displayName', 'body', 'replyTo', 'createdAt', 'status'],
  DeleteRequests: ['requestId', 'targetType', 'targetId', 'requesterId', 'reason', 'createdAt', 'status']
};
function moderationTable_(config, name) {
  const headers = MODERATION_SCHEMAS_[name];
  const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(name);
  if (!sheet || sheet.getLastColumn() < headers.length ||
      !sheet.getRange(1, 1, 1, headers.length).getValues()[0].every((v, i) => v === headers[i])) {
    adminFail_('SCHEMA', name + 'の列見出しを確認してください。自動変更は行いません。');
  }
  const ids = new Set();
  const values = sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const records = values.map((row, i) => {
    if (row.every(v => v === '')) return null;
    if (typeof row[0] !== 'string' || !row[0].trim() || ids.has(row[0])) adminFail_('SCHEMA', name + 'に空ID・重複ID・不正なIDがあります。');
    ids.add(row[0]);
    return { values: row, rowNumber: i + 2 };
  }).filter(Boolean);
  return { sheet: sheet, records: records, statusColumn: headers.length };
}
function moderationFind_(table, id) {
  const record = table.records.find(r => r.values[0] === id);
  if (!record) adminFail_('NOT_FOUND', '対象が見つかりません。一覧を再読み込みしてください。');
  return record;
}
function moderationString_(value) { return value == null ? '' : String(value); }
function moderationDate_(value) {
  return value instanceof Date ? (isNaN(value.getTime()) ? '' : value.toISOString()) : moderationString_(value);
}
function moderationKnown_(status) { return ['published', 'hidden', 'deleted'].indexOf(status) !== -1; }
function moderationContentRevision_(record) { return topicRevision_(record.values.slice(0, -1)); }
function moderationWriteStatus_(table, record, status) {
  table.sheet.getRange(record.rowNumber, table.statusColumn, 1, 1).setValues([[status]]);
  SpreadsheetApp.flush();
}
function moderationUpdate_(config, name, input) {
  topicInput_(input, ['id', 'status', 'revision']);
  if (typeof input.id !== 'string' || !input.id || typeof input.revision !== 'string' ||
      !moderationKnown_(input.status)) adminFail_('VALIDATION', '対象ID・状態・更新情報を確認してください。');
  const table = moderationTable_(config, name);
  const record = moderationFind_(table, input.id);
  const current = record.values[table.statusColumn - 1];
  if (!moderationKnown_(current)) adminFail_('STATUS', '想定外の状態です。自動変更せず、シートを確認してください。');
  if (topicRevision_(record.values) !== input.revision) adminFail_('CONFLICT', '別の操作で更新されています。一覧を再読み込みしてください。');
  if (current === 'deleted') adminFail_('STATUS', '削除済みのデータは再公開・変更できません。');
  if (current !== input.status) moderationWriteStatus_(table, record, input.status);
  return { id: input.id, status: input.status };
}
