// Configure these in Script Properties of the NEW admin-only project.
function adminConfig_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = String(props.getProperty('SPREADSHEET_ID') || '').trim();
  const adminEmail = String(props.getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!spreadsheetId || !adminEmail) adminFail_('CONFIG', '管理用の接続設定が未完了です。設定手順を確認してください。');
  return { spreadsheetId: spreadsheetId, adminEmail: adminEmail };
}
function assertAdmin_() {
  const config = adminConfig_();
  // MYSELF deployment is the primary access boundary. Fail closed if identity is unavailable.
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!active || active !== config.adminEmail || effective !== config.adminEmail) {
    adminFail_('FORBIDDEN', 'この管理画面を利用する権限がありません。');
  }
  return config;
}
function adminFail_(code, message) {
  const error = new Error(message);
  error.adminCode = code;
  throw error;
}
function adminCall_(callback) {
  try {
    const config = assertAdmin_();
    return { ok: true, data: callback(config) };
  } catch (error) {
    return { ok: false, error: {
      code: error.adminCode || 'INTERNAL',
      message: error.adminCode ? error.message : '処理を完了できませんでした。一覧を再読み込みして保存結果を確認してください。'
    } };
  }
}
