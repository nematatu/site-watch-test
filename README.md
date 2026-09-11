# site-watch-test

`https://amatatu.com/`の`<main>`内の表示テキストを1分ごとに監視し、変更時にntfyへ通知するCloudflare WorkersのE2Eデモです。

## エンドポイント

- `GET /`: 稼働状態と現在のbaseline情報を返します。
- `POST /check`: Secret認証付きで監視を即時実行し、`baseline`、`unchanged`、`changed`をJSONで返します。

```bash
curl https://site-watch-test.<subdomain>.workers.dev/
curl -X POST -H "Authorization: Bearer $MANUAL_TRIGGER_TOKEN" https://site-watch-test.<subdomain>.workers.dev/check
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
bunx wrangler secret put NTFY_TOKEN
bunx wrangler secret put MANUAL_TRIGGER_TOKEN
bun run types
bun run typecheck
bun test
bun run deploy
```

初回はbaseline保存のみで通知しません。2回目以降、正規化した`<main>`のSHA-256が変わった場合だけ通知し、ntfy成功後にKVを更新します。HTTPエラー、timeout、HTML解析失敗、ntfy失敗時は正常なKVを上書きしません。

`NTFY_TOKEN`にはntfyアカウントで発行したAccess Tokenを登録します。Cloudflare Workersの共有送信元IPが匿名投稿のrate limitを受ける可能性があるため、本番では認証投稿を推奨します。

CronはE2E確認用に毎分です。検証後は頻度を下げてください。

## 判定結果

`POST /check`は次のいずれかを返します。

- `baseline`: 初回状態をKVへ保存。通知なし。
- `unchanged`: 前回と同じ。通知・KV書き込みなし。
- `changed`: 更新を検知し、ntfy成功後にKVを更新。

認証がなければ`401`、対象取得やntfyが失敗した場合は`502`を返します。Cron実行時も同じ処理を利用し、結果をWorkers Logsへ構造化出力します。
