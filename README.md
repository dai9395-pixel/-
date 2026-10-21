# スタッフ成長カルテ

「数字の管理から、人の成長を支える管理へ」をコンセプトにした、美容室向けのスタッフ育成Webアプリです。管理者1人の試用向けに、架空のスタッフ15人・3店舗・直近6か月の売上を初回起動時に登録します。

## iPadだけで使うクラウド版（Vercel + Supabase）

[Supabase接続・公開手順はこちら](DEPLOY.md)。VercelのPython APIからSupabase Authで本人確認し、ログインユーザーのJWTでPostgreSQLへ保存します。RLSにより、明示的に許可された管理者だけが全スタッフの読み書きを行えます。PCの常時起動は不要です。

環境変数は `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` に対応します。設定例は `.env.example`、テーブル・架空データ15名・RLSの統合SQLは `supabase/install.sql`、管理者許可は `supabase/003_add_admin.sql` です。service_roleキー・旧ADMIN_PASSWORDは不要です。実際のクラウド接続は設定とSQL実行後に別途検証します。

クラウド版の構成：`api/index.py`（認証付きAPI）、`lib/cloud_store.py`（Supabase REST）、`scripts/build.py`（静的ファイルの出力）、`vercel.json`（ルーティング・ヘッダー）、`public/auth.js`（ログイン）。依存パッケージは不要です。


## 店舗管理の追加

店舗の追加・編集・無効化、スタッフ異動、店舗別集計、全店舗比較を追加しています。既存環境には `supabase/004_stores.sql` を適用します。既存カルテ本文を維持し、異動前に登録済みの月の売上集計先も保持します。

**[データ保持・集計ルール・本番反映手順](STORE_MIGRATION.md)** を確認してください。本番反映は確認後に行います。新規DBの場合も `install.sql` と管理者設定に続けて `004_stores.sql` が必要です。

## Supabase版を開発環境で確認する

環境に接続変数2つを安全に設定したうえで `python server.py --cloud --port 8000` を起動します。Supabase Authと同じAPIを使用し、SQLiteは作成・参照しません。設定値はコードやコマンド履歴へ直接書かないでください。SQLの実行と管理者許可はクラウド版と同じ手順が必要です。

## ローカルSQLite版の起動

Python 3.10以上が必要です。外部パッケージのインストールは不要です。

```bash
cd /workspace/-
python server.py --port 8000
```

同じマシンのブラウザーで `http://127.0.0.1:8000` を開きます。終了は Ctrl+C。

iPadなど別の端末からアクセスする場合は、信頼できるローカルネットワークで `python server.py --host 0.0.0.0 --port 8000` を起動し、サーバーのLAN IPアドレスとポート8000へアクセスします。クラウドでの外部アクセスには利用するサービスのポート公開設定が別途必要です。

**ローカルSQLite版にはログイン・権限管理がありません。インターネットへの一般公開や実際の個人情報の入力は行わず、架空データで試用してください。**

## 操作

- 左の一覧からスタッフを選択。名前・店舗検索、店舗フィルターに対応。
- 「スタッフを追加」「基本情報を編集」から名前・店舗・役職を管理。
- 表示月を選び「売上を入力」。同じ月の登録は更新。売上目標、実績、指名売上、客数を入力すると達成率・指名比率・客単価を計算。目標・客数が0の場合は0として表示。
- 月別グラフは登録された直近12か月を表示。未登録月を架空の0円データで埋めません。
- 「目標・アクション」で理想像、年間・月間目標、課題、行動、達成率を記録。
- スキルは6分野を1〜5で評価。同じ日の評価は更新し、別の日の記録は履歴に保存。直前の評価との差も表示。
- 面談は追加・編集可能。過去の面談を日付順に展開して確認。
- スタッフ削除は確認後にすべての関連記録を削除します。

## ローカルSQLite版の保存とバックアップ

`data/karte.sqlite3` にサーバー側で自動保存します。ブラウザーを閉じたりサーバーを再起動しても保持されます。初回のサンプル投入は一度のみで、スタッフ全員を削除しても再投入しません。DBはGit管理対象外です。

バックアップはサーバー停止後に `data/karte.sqlite3` を安全な場所へコピーしてください。復元も停止中に行います。別のDBを使う場合は `KARTE_DB=/保存先/karte.sqlite3 python server.py` と指定できます。クラウド環境自体を破棄した場合の保持はサービスの永続ディスク・スナップショット設定によります。

## 構成・将来の拡張

- `public/`: 日本語のレスポンシブUI。外部CDNやフォントに依存しません。
- `server.py`: Python標準HTTPサーバー、SQLite、JSON API。
- `GET /api/staff` / `POST /api/staff` / `PUT /api/staff/:id` / `DELETE /api/staff/:id`
- 更新と削除には読み込み時の `version` が必要です。古い版からの書き込みは409で拒否し、意図しない上書きを防ぎます。エラー時は画面の再読み込みが必要です。

クラウド版はSupabase AuthとPostgreSQL RLSで管理者を認証・制限します。将来は店舗別権限、監査ログ、MFAなどを追加できます。ローカルの `server.py` は開発・試用用です。クラウド版もまずは架空データで試用してください。

## 動作確認

```bash
python -m unittest discover -s tests -v
node --check public/app.js
```

APIのテストは一時DB・ポート18081を使用し、初回サンプル15名、追加、売上・評価・面談更新、不正な数値の拒否、更新競合、サーバー再起動後の保持、削除を確認します。実データには触れません。

クラウドAPIは `tests/test_cloud.py` で認証・CRUD・競合・接続失敗をテストします。Supabase通信はモックで、実サービスの接続検証とは区別しています。

任意のブラウザーテスト（Node.js、Playwright、Chromiumが利用できる環境）:

```bash
node tests/browser.cjs
```

`CHROMIUM_PATH` でブラウザーの実行ファイルを指定できます（既定 `/usr/bin/chromium`）。一時DB・ポート18082を使用し、登録・保存・計算・再読み込み・削除・検索、1194/834/768/390pxの画面幅とJavaScriptエラーを確認します。

PostgreSQLの権限・永続化テスト（任意、PGliteが必要）:

```bash
PGLITE_MODULE=/path/to/@electric-sql/pglite node tests/auth_schema.cjs
```

Supabase Authはモック、RLSは実際のSQLをPostgreSQL互換エンジンで実行します。未ログイン・非管理者・自己昇格の拒否、許可管理者のCRUDと権限取り消し、DB再起動後の保持を確認します。
