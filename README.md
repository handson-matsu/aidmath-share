# AidMath-Share

数学探究の作品ギャラリーとコメント・返信を提供する、日本語の静的Webアプリです。実行時の外部ライブラリやビルドは不要です。

## ファイル

- `index.html`: ページ共通枠、削除申請ダイアログ
- `style.css`: PC・タブレット・スマートフォン向けの表示
- `app.js`: ハッシュルーティング、API接続、画像検証、投稿・返信・削除申請
- `tests/smoke.cjs`: モックAPIを使ったブラウザ操作テスト（開発時のみPlaywrightが必要）

## 起動と公開

ローカルではこのディレクトリで `python3 -m http.server 8000` を実行して `http://localhost:8000` を開きます。
GitHub Pagesでは、この3つのアプリファイルを同じディレクトリに置き、リポジトリのPages公開対象にそのディレクトリを指定します。画面のURLはハッシュ形式なので、作品詳細を直接開いてもサーバーのURL書き換え設定は不要です。この作業ではGitHubへのpushや公開設定の変更は行っていません。

## GAS接続の現状

2026-09-28に現在の実APIをブラウザから確認しました。Topics、作品本文の投稿・一覧取得、コメント投稿・再取得は成功しています。クロスオリジン通信も実ブラウザで確認しています。POSTはGASの `e.parameter` に合わせたフォーム形式に修正しました。

提供されたGASソースに合わせて、画像送信を `imageData` / `imageType`、画像受信を `data` / `mimeType` に修正しました。GASとデザインは変更していません。2026-09-28、管理者によるDrive権限承認・バージョン3への更新後、実APIでPNG画像付き作品の保存、画像データの一致、詳細表示と再読み込み、コメント・返信の保存と再表示を確認しました。接続の確認記録は [GAS-INTEGRATION.md](GAS-INTEGRATION.md) を参照してください。

### GET成功応答

```json
{"ok":true,"topics":[{"topicId":"tiling","title":"敷き詰めパターン","description":"テーマの説明"}]}
```

```json
{"ok":true,"posts":[{"postId":"p1","displayName":"探究さん","title":"作品タイトル","body":"説明文","createdAt":"2026-09-28T00:00:00Z"}]}
```

```json
{"ok":true,"comments":[{"commentId":"c1","replyTo":"","displayName":"数学さん","body":"コメント","createdAt":"2026-09-28T00:00:00Z"}]}
```

```json
{"ok":true,"hasImage":true,"mimeType":"image/png","data":"BASE64_ENCODED_IMAGE"}
```

一覧は配列単体、または `data` 配下の同形式でも受け付けます。レコードの `id`、作品の `description`、コメントの `parentId` / `content` など一部の別名にも対応しています。画像は `imageBase64` または `dataUrl` / `imageDataUrl`（JPEG・PNG・WebPのbase64データURL）にも対応します。任意URLへのリダイレクトやDriveの共有URLを返す形式には対応していません。画像の取得口から画像データをJSONで返してください。

### POSTリクエスト

URLの `?action=...` とフォーム本文の `action` の両方に操作名を付けます。本文は `URLSearchParams` による `application/x-www-form-urlencoded;charset=UTF-8` 形式です。GASでは `e.parameter` から読み取ります。JSON本文では題材が読み取られず、実APIが拒否することを確認しました。

| action | フォーム項目（action以外） |
| --- | --- |
| createPost | topicId, authorId, displayName, title, body, imageType, imageData（接頭辞なしのbase64） |
| createComment | postId, authorId, displayName, body, replyTo（通常コメントは空文字） |
| requestDelete | targetType（post / comment）, targetId, requesterId, reason（実APIでの申請は未検証） |

書き込み成功は `{"ok":true}` または `{"success":true}` が必要です。取得も送信も、ブラウザから読めるJSON応答である必要があります。GASをWebアプリとして公開し、想定する匿名利用者がアクセスできる設定とクロスオリジンでの動作を確認してください。応答が読めない場合に `no-cors` で成功扱いにはしません。送信結果不明時は二重投稿を避けるため、一覧確認を案内します。

## 実装済み機能

- 題材一覧、作品一覧（新しい順）、作品詳細
- 表示名・タイトル・説明文・画像の作品投稿
- JPEG / PNG / WebP、5MiB以下のチェック、ファイルヘッダーと画像デコードの検証、プレビュー
- コメント・返信と元コメント番号への移動。投稿日時順で会話を表示
- 作品・コメントの削除申請（削除そのものは実行しない）
- localStorageにランダムな匿名IDを保存。画面には表示しない
- 読み込み失敗・空一覧・投稿中の表示、二重クリック抑止、再読み込み
- `textContent` による文字列表示、管理用データの非表示、画像の遅延読み込み

## 運用上の注意

クライアントの検証だけでは不正リクエストを防げません。GAS側でもファイル形式・容量、文字数、題材/作品/返信先の存在と所属、削除対象、リクエスト頻度を検証してください。返すレコードも公開用の項目に絞り、例外には内部IDや管理URLを含めないことを推奨します。フロント側ではそのような診断情報を表示しませんが、API応答自体は開発者ツールから確認できます。

匿名IDはログイン認証ではありません。ブラウザデータを消すと変わり、共有端末では同一IDになります。ストレージが無効な環境では閲覧のみ可能で、送信時に案内します。大きな作品数ではGASの負荷・転送量を考慮し、将来ページ分割やサムネイルAPIを追加してください。

## テスト

開発用にNode.js、Playwright、およびChromeを用意して `node tests/smoke.cjs` を実行します（Playwrightを別パスに置く場合は `NODE_PATH` を指定）。すべてのAPI通信をモックに置き換え、実GASへの書き込みはしません。ギャラリー、文字列の安全な表示、返信先、削除申請、画像検証・投稿、匿名IDの維持、モバイルの横溢れ、内部エラーの非表示を確認します。

実APIの読み取り確認は `node tests/live-read.cjs` で実行できます。モックは使用せず、localhostの画面から実GASへ接続します。POSTは明示的にブロックし、既存のテスト作品とコメントを確認します。別の作品を確認する場合は `LIVE_POST_ID` を指定してください。修正前の画像なし作品を指定した場合、画像確認は失敗します。
