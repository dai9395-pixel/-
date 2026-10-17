# Supabase接続・認証の設定（iPadのSafari対応）

VercelのWeb画面 → Python API → Supabase Auth / PostgreSQL の構成です。APIはログインユーザーのJWTを検証し、そのユーザーの権限でDBへアクセスします。RLS（行レベルセキュリティ）が直接のDBアクセスにも適用されます。管理者として許可されたユーザーだけが全15名のカルテを管理できます。

共有パスワードやservice_roleキーを使う旧方式から変更しました。スタッフデータは既存の `staff` テーブルに維持し、削除・上書きしません。旧SQLiteのデータは自動移行しません。

**店舗管理の追加がある既存環境では、[店舗管理マイグレーション手順](STORE_MIGRATION.md)を優先し、サンプル作成SQLを再実行しないでください。新規環境では以下の初期設定に続けて `004_stores.sql` を適用します。**

## 1. 環境変数の確認

Vercel → 対象Project → Settings → Environment Variablesに以下を設定します。既存の値が正しければ再入力は不要です。**名前には空白ではなくアンダースコアを使います。**

| 名前 | 内容 |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://プロジェクトID.supabase.co`（`/rest/v1`は付けない） |
| `VITE_SUPABASE_ANON_KEY` | 同じSupabaseプロジェクトの公開 `anon` キー（publishableキーも可） |

Viteを使用していないアプリですが、指定されたこの2つの変数名に対応しています。環境変数はPython APIから参照し、HTMLに埋め込みません。Productionを設定対象にし、Previewも使う場合はPreviewにも設定してください。設定変更後はRedeployが必要です。

以前の `ADMIN_PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` は不要なので、Vercelから削除できます。**service_role / secretキーをanonキーの欄に入れないでください。** 公開キーだけではデータを読み書きできず、ログインと管理者許可が必要です。

## 2. テーブル・サンプル15名・RLSを作成

1. Safariで対象Supabaseプロジェクトを開き、「SQL Editor」→「New query」を選びます。
2. GitHubで [`supabase/install.sql`](https://github.com/dai9395-pixel/-/blob/main/supabase/install.sql) を開き、「Raw」から全文をコピーします。
3. SQL Editorに貼り付け「Run」で実行します。
4. 下記でスタッフ数を確認します。新規DBなら15になります。既存DBの人数は変更しません。

```sql
SELECT count(*) FROM public.staff;
```

作成内容：

- `staff`: スタッフ基本情報と売上・目標・スキル・面談をJSONBで保存。`id` と競合検出用 `version` を持ちます。
- `karte_metadata`: 初回サンプル作成済みの印。再実行時の重複・削除後の勝手な再投入を防ぎます。
- `karte_admins`: 管理者ユーザーIDと有効状態。通常のログインユーザーからの閲覧・変更を禁止します。
- `is_karte_admin()`: 現在のログインユーザーが管理者かを確認する関数。
- `staff` のRLS: 未ログインは拒否。ログイン済みでも未許可なら拒否。許可された管理者のみ読み込み・追加・編集・削除が可能。

`install.sql` は再実行しても既存のデータを保持します。このアプリのstaff/karte_adminsテーブルの既存ポリシーは管理者限定に置き換えます。他用途と同じテーブルを共有しないでください。旧 `setup.sql` だけを後から再実行せず、必ず統合版の `install.sql` を使ってください。

## 3. 管理者のログインアカウントを作成

1. Supabase →「Authentication」→「Users」→「Add user」→「Create new user」で、管理者のメールアドレスと十分に強いパスワードを設定します。
2. 確認済みユーザーとして作成する設定（Auto Confirm User）がある場合は有効にします。作成後、メール確認状態を確認してください。
3. Authenticationの「Sign In / Providers」または「Providers」→ Emailでメール・パスワードログインを有効にし、**新規ユーザーの自己登録（Allow new users to sign up）は無効**にします。画面名はSupabaseの更新によって変わることがあります。
4. パスワードはiPadのパスワード管理へ保存し、チャットやGitHubへ書き込まないでください。

アプリには新規登録画面がありません。パスワードを忘れた場合はSupabaseのユーザー管理から安全に再設定してください。一般向けのパスワード再設定画面は未実装です。

## 4. このユーザーを管理者として許可

1. [`supabase/003_add_admin.sql`](https://github.com/dai9395-pixel/-/blob/main/supabase/003_add_admin.sql) を開き、SQL Editorへコピーします。
2. SQL内の `REPLACE_WITH_ADMIN_EMAIL` を、直前に作成した管理者のメールアドレスに置き換えます。
3. Runで実行します。該当ユーザーが見つからなければエラーになり、誰も許可しません。

自分を管理者へ昇格させるアプリの機能はありません。将来、別の管理者を追加する場合も、同じ手順で明示的に許可します。許可された管理者はすべてのスタッフカルテにアクセスできるため、スタッフ本人のアカウントはこの一覧に追加しないでください。

アクセスを取り消す場合はSQL Editorで実行します。

```sql
UPDATE public.karte_admins
SET active = false
WHERE user_id IN (
 SELECT id FROM auth.users WHERE email = 'アクセスを取り消すメールアドレス'
);
```

次のAPI/DBアクセスから拒否します。すでに画面に読み込まれた内容を遠隔消去するものではありません。

管理者許可の後、新規環境では `supabase/004_stores.sql` もSQL Editorで実行してください。既存の環境は `STORE_MIGRATION.md` の手順で適用します。

## 5. Vercelで再デプロイ

GitHubの `dai9395-pixel/-` のmainを利用します。初回ならVercelにImportし、Project Nameを `staff-growth-karte` などにし、FrameworkはOther、Rootはリポジトリルートです。既存Projectなら最新コミットのデプロイ完了を確認します。

- Build Command: `python3 scripts/build.py`
- Output Directory: `dist`
- 外部Python/npm依存パッケージのインストールは不要です。

設定値を追加・変更した後は、VercelのDeploymentsからRedeployしてください。完了後のProduction URL（HTTPS）をiPadのSafariで開き、Supabaseに作成したメールアドレスとパスワードでログインします。旧共有パスワードではログインできません。

## 6. 保存・編集・再読み込みの確認

まずは架空データで以下を確認します。

1. 15名のスタッフを表示し、一人を選びます。
2. 月間売上、目標、スキル評価、面談記録をそれぞれ保存します。
3. Safariのページを再読み込みし、再ログインします。4種類の保存内容が残っていることを確認します。
4. Safariを閉じ、同じURLを開いて再ログインし、保存内容が残っていることを確認します。入力途中の未保存の内容は保持しません。
5. Supabase Table Editorのstaffテーブルに同じ内容が保存されていることを確認します。Vercel再デプロイでもデータは残ります。
6. 権限テストをする場合は別のテストユーザーを作成し、karte_adminsに登録せずにログインします。「管理者として登録されていません」と表示され、カルテを閲覧・編集できないことを確認します。

ログイン情報・アクセストークンはブラウザーのメモリ内だけで管理し、localStorageには保存しません。ページ再読み込みや終了後は再ログインしますが、カルテ自体はSupabaseに残ります。ページを開いている間のトークン期限切れはリフレッシュトークンで更新します。利用後はログアウトしてください。

Safariの共有メニューから「ホーム画面に追加」すると、ホーム画面から開けます。オンライン利用が必要です。

## エラーの切り分け

- **設定未完了**: 変数名、設定対象（Production/Preview）、Redeployを確認します。設定が別サービスにある場合はVercelにも必要です。
- **ログインできない**: 同じSupabaseプロジェクトのURL・公開キーを使っているか、Authenticationのユーザーが確認済みか、Emailログインが有効かを確認します。
- **管理者として登録されていない**: `003_add_admin.sql` のメールアドレスと `karte_admins.active` を確認します。
- **SQL・接続エラー**: `install.sql` が完了しているか、プロジェクトが稼働中かを確認します。
- **更新の競合**: 内容を控えてから再読み込みし、最新の記録を確認して再編集します。
- **旧画面のまま**: Vercelの最新Productionデプロイがmainを指しているか確認し、Safariを再読み込みします。

SQL Editorの管理者はRLSを迂回できるので、SQL EditorでのSELECT成功だけではアプリの権限テストになりません。秘密キー・パスワード・個人情報を含むログは共有しないでください。

## 検証範囲と運用

自動テストでは、APIの保存・競合処理、ブラウザーでの操作・認証UI・期限切れ更新、PostgreSQL互換環境での管理者CRUD・未ログイン/非管理者拒否・自己昇格拒否・DB再起動後の保持を検証します。実Supabaseへの接続確認は、接続設定とSQL実行後に上記の手順で別途行います。

本番の個人情報を入力する前に、管理者端末のロック・アカウント管理・バックアップと復元手順・利用するSupabaseプランの保管/休止条件を確認してください。MFA、店舗ごとの権限、監査ログは今後の追加機能です。
