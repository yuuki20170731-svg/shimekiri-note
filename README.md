# 締切ノート

就職活動の案内メールに埋もれがちな「企業・締切・提出物・提出先」を、確認してから一覧に残すWebアプリです。スマホで案内を受け取り、PCで提出する就活生を想定しています。

**[公開デモを試す](https://shimekiri-note-2026.pages.dev/)** · [作品紹介を見る](https://shimekiri-note-2026.pages.dev/about.html) · [設計と改善の記録](PORTFOLIO.md)

公開デモは架空データで操作できます。アカウントを作ると、確認した締切をオンラインに保存できます。スマホとPC間の同期は検証中です。サンプルでの変更は保存・同期されないため、実際の案内メールは貼り付けないでください。

## 主な機能

- メール本文を端末内のルールで解析し、企業名、提出物、締切日時、提出先リンクの候補を読み取る
- 日付候補を端末内で判定する。Jevによる追加判定の試験実装は、無料の公開版では無効
- Gmailの検索結果からメールを選んで取り込む（Googleの承認済みテスト利用者のみ）
- 候補を確認・修正し、足りない項目は手入力する
- 締切が近い順に確認し、詳細の編集や提出済みへの変更を行う
- メールで新規登録し、Supabaseに締切情報を保存する
- 3日前と前日09:00（日本時間）の通知を予約する仕組みを実装

候補は自動保存しません。年が書かれていない日付や時刻不明の締切を勝手に確定せず、読み取りに失敗した場合も手入力で進めるようにしています。Androidで「候補が見えない」、入力文字が薄いという指摘を受け、結果への移動と表示のコントラストを改善しました。メールのすべての書式を正確に読めるわけではないため、保存前に必ず元の案内と照合します。

## 技術

React、TypeScript、Vite、Supabase Auth/PostgreSQL、Supabase Edge Functions/Cron、Brevo、Web Push、Gmail API、Cloudflare Pages。メール本文はブラウザ内で候補化し、データベースには確認後の締切情報のみ保存します。Gmail連携はGoogleのテストモード中で、登録済みテスト利用者だけが利用できます。

## ローカル起動

Node.js 22.13以上とpnpm 11.25を用意してください。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`http://localhost:5173/`で架空データのサンプル体験を試せます。オンライン保存を使う場合だけ、`.env.example`を参考に`.env.local`へSupabaseの**公開用**URLとpublishable keyを設定します。Gmail連携にはGoogle CloudのWeb用クライアントIDも必要です。Client Secret、service role key、SMTPキーをブラウザ用の環境変数に入れないでください。

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Cloudflare Pagesの無料公開版へは、ビルド後の`dist`から`index.html`、`assets/`、`sw.js`、公開用SVG、`privacy.html`だけをアップロードします。`dist/.openai/`、`_worker.js`、`_routes.json`は配信対象に含めません。試験実装したJevはTypeSafeの第三者モデルで、Cloudflare AI Gatewayの前払いクレジットが必要でした。無料公開版では`VITE_JEV_ENABLED`を設定せず、AIバインディングを使用しません。再有効化する場合は、料金・プライバシーを確認し、`VITE_JEV_ENABLED=true`と本番のAIバインディング・Supabase公開用設定を揃える必要があります。管理用キーをブラウザに設定しないでください。

## 検証状況

41件の自動テスト、型チェック、lint、ビルドを通過。PCでの実アカウントによる保存・編集と、公開デモでの架空メール候補表示を確認しました。Gmail一覧・検索が動作し、Androidで利用者が選んだ実メールから企業名・締切日・時刻を正しく候補化できました。Jevへの試験リクエストはCloudflareの「AI Gatewayクレジット不足（2021）」で拒否されたため、無料版では無効にしました。AndroidとPCの同期、Androidへのプッシュ通知、締切メールの実着信は未確認です。通知の到着を保証する表示にはしていません。
