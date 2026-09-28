# requestId対応GASの反映手順

ユーザーによる公開GAS・Posts J列への反映と、実API検証は完了しました。新フロントの公開はまだ行っていません。以下は再セットアップ時の手順です。旧GASではrequestIdが無視されるため、新フロントはpostStatusのプロトコルを確認できるまで投稿を送信しません。

1. 現在のGASとPostsシートをバックアップする。
2. PostsのJ列が未使用であることを確認し、J1に `requestId` を追加する。既存のA〜I列は移動しない。既存行のJ列は空欄のままでよい。
3. GASの既存 `createPost` 関数だけを削除し、`post-requests.gs` の内容で置き換える。その他の関数・ID設定はそのまま残す。このファイルは単体では動作せず、既存のgetSheet、cleanText、saveImage等を利用する。
4. `doGet` のswitchへ以下を追加する。

```js
case 'postStatus':
  return jsonResponse(getPostStatus(e.parameter));
```

5. 同じWebアプリの新バージョンとしてデプロイする。既存URL・実行ユーザー・公開範囲を維持する。
6. 既存作品（J列空欄）の表示を確認し、テスト作品で投稿・照会・同じrequestIdの再送を確認してからフロントを公開する。

## 仕様

- createPostはrequestIdとauthorIdで既存行を検索。保存済みなら元のpostIdを返す。本文の変更を伴う同一IDの再送も新しい作品を作らず、最初の作品を返す。
- ScriptLockを重複確認から画像保存・行追加・flushまで保持。同時実行時はprocessingを返す。全作品投稿を直列化するため、長い画像保存中は別の投稿も待機扱いになる。
- requestIdは作品と同じ行に保存する。成功後の応答喪失・flush例外でも次回照会で行を検出できる。
- postStatusはsaved / processing / not_foundを返す。not_foundは遅れて到着するリクエストを否定しない。再送は必ず同じID。
- 既存行は正常に閲覧できる。旧フロントからrequestIdなしの投稿も受け付けるが、その投稿は重複防止対象外。
- authorIdは認証ではない。requestId/authorIdは画面に表示しない。公開一覧にrequestIdを追加しない。
- 元作品が非公開になっても同じrequestIdでは新規作成しない。重複判定はpublished以外の行も対象とする。管理者が行を物理削除すると、そのIDの重複防止記録も失われるので行は残しstatusで管理する。
- DriveとSheetsは別サービス。画像保存後・行追加前に強制終了すると孤立画像が残り得る。今回の保証は作品行の重複防止であり、孤立ファイルの回収は未実装。
- 再読み込み後はlocalStorageのIDで自動照会する。画像は永続保存せず、再読み込み後の画像再送は行わない。未確定IDを自動破棄しないので、解決できなければ管理者による照合が必要。

今回はコメント・返信・削除申請・画像取得・アクセスカウンターを変更しない。GASの稼働環境で既存作品、投稿、結果照会、同一IDの並行再送を確認済み。応答喪失と結果照会不能はモックで検証済み。
