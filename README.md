# site-watch-test

`https://amatatu.com/`の`<main>`内の表示テキストを1分ごとに監視し、変更時だけntfyへ通知するCloudflare Workerです。

## エンドポイント

- `GET /`: 稼働状態と現在のbaseline情報を返します。

```bash
curl https://site-watch-test.<subdomain>.workers.dev/
```

## セットアップ

```bash
bun install
bunx wrangler login
bunx wrangler kv namespace create WATCH_STATE
```

作成されたIDを`wrangler.jsonc`の`REPLACE_WITH_KV_NAMESPACE_ID`へ設定します。続いてSecretを登録します。

```bash
bunx wrangler secret put NTFY_TOPIC
bun run types
bun run typecheck
bun test
bun run deploy
```

初回はbaseline保存のみで通知しません。2回目以降、正規化した`<main>`のSHA-256が変わった場合だけ通知し、ntfy成功後にKVを更新します。HTTPエラー、timeout、HTML解析失敗、ntfy失敗時は正常なKVを上書きしません。

Cronは動作確認用に毎分です。完成後に`amatatu.com`を実際に変更すると、次回のCronで変更を検知して通知します。

## 判定結果

Cronの判定結果は次のいずれかです。

- `baseline`: 初回状態をKVへ保存。通知なし。
- `unchanged`: 前回と同じ。通知・KV書き込みなし。
- `changed`: 更新を検知し、ntfy成功後にKVを更新。

判定結果はWorkers Logsへ構造化出力します。
