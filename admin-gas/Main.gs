function doGet() {
  try {
    assertAdmin_();
    return HtmlService.createTemplateFromFile('Index').evaluate()
      .setTitle('AidMath-Share 管理')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    return HtmlService.createHtmlOutput('<p>管理画面を開けません。管理者のGoogleアカウントと設定を確認してください。</p>');
  }
}
// Trailing underscore prevents direct google.script.run calls to helpers.
function include_(name) {
  if (['Styles', 'App'].indexOf(name) === -1) throw new Error('Unknown template');
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
