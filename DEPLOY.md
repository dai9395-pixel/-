# iPadのSafariだけで公開する手順

VercelでWeb画面とPython APIを公開し、SupabaseのPostgreSQLに保存します。PCの常時起動は不要です。Vercelの再起動・再デプロイでデータは消えません。公開URLはデプロイ完了後にVercelが発行します。この手順の作成だけでは公開は完了しません。

まずは架空データ専用の試用環境です。Safariで各サービスにログインし、文字が小さい場合はSafariのページメニューから「デスクトップ用Webサイトを表示」を選んでください。サービスのプラン・利用上限・無料環境の休止条件は申込画面で確認してください。

## 1. GitHubにコードを用意

対象リポジトリは `dai9395-pixel/-` です。このリポジトリに、このプロジェクトのファイル（`vercel.json`、`api/`、`lib/`、`server.py`、`scripts/`、`public/`、`supabase/`）が反映されていることを確認します。

秘密キー・実データ・`data/`・`.env` はGitHubへ登録しません。GitHubの認証情報をチャットに送る必要はありません。

## 2. Supabaseのアカウントとプロジェクトを作成

1. Safariで https://supabase.com/dashboard を開き、GitHubアカウントなどで登録します。
2. 組織を作成し、「New project」から `staff-growth-karte` プロジェクトを作成します。
3. データベースのパスワードを生成して、iPadのパスワード管理に保存します。このパスワードはアプリのログインパスワードとは別です。
4. 利用可能なら日本に近いリージョンを選び、作成完了を待ちます。
5. 「SQL Editor」→新しいクエリを開きます。GitHubで `supabase/setup.sql` を開き、「Raw」でファイルの内容全体をコピーし、SQL Editorへ貼り付けて「Run」を押します。
6. 「Table Editor」の `staff` に架空スタッフ15行があることを確認します。必要ならSQL Editorで `SELECT count(*) FROM public.staff;` を実行します。

`setup.sql` は再実行しても既存のスタッフや編集内容を上書きしません。全員を削除した後もサンプルを復活させません。旧SQLiteからの個人情報の移行は行いません。

## 3. Supabaseの接続情報を確認

プロジェクトの「Connect」または「Settings」→「API / API Keys」で次を確認します（名称は管理画面の更新で変わることがあります）。

- **Project URL**: `https://プロジェクト識別子.supabase.co`
- **Legacy API Keysの `service_role` キー**: サーバー専用の秘密キー。`anon` や publishable キーではありません。

URLとキーは次のVercel設定に入力します。**service_roleキーはGitHub、画面のソース、チャットに貼り付けないでください。** このキーはRLSを迂回できるため、サーバー内に限定します。SQLはブラウザーから使う `anon` / `authenticated` ロールの読み書きを拒否します。

## 4. Vercelへ登録してGitHubから取り込む

1. Safariで https://vercel.com/signup を開き、GitHubで登録します。
2. 「Add New…」→「Project」からGitHubを接続します。必要ならVercelのGitHub連携に対象リポジトリへのアクセスを許可します。
3. `dai9395-pixel/-` を選び「Import」を押します。
4. **Project Nameを `staff-growth-karte` など有効な名前に変更**してください（元のリポジトリ名 `-` はプロジェクト名に適しません）。
5. Framework Presetは **Other**、Root Directoryはリポジトリのルート（空欄または `./`）にします。
6. Build Command / Output Directoryは `vercel.json` から読み込ませます。手動指定が必要なら Build Commandは `python3 scripts/build.py`、Output Directoryは `dist`、Install Commandは空欄です。npmパッケージのインストールは不要です。
7. デプロイ前の「Environment Variables」に次の3つを追加します。秘密情報はここへ直接入力します。Productionを対象に設定し、Previewでも試す場合はPreviewにも同じ設定が必要です。

| 変数名 | 入力する内容 |
| --- | --- |
| `SUPABASE_URL` | SupabaseのProject URL（末尾の `/rest/v1` は不要） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseの `service_role` キー |
| `ADMIN_PASSWORD` | このアプリ専用の、16文字以上のランダムで推測されにくいパスワード |

`ADMIN_PASSWORD` はiPadのパスワード管理へ保存します。SupabaseのDBパスワードやGitHubのパスワードを流用しません。設定値を後から変更した場合は**Redeployが必要**です。

8. 「Deploy」を押します。完了後の「Visit」またはProduction Domainから、実際に発行された `https://…vercel.app` をSafariで開きます。`localhost` やクラウドマシンのIPは使いません。
9. 管理者パスワードでログインします。画面には架空スタッフ15人と売上・評価・面談が表示されます。

Vercel側のDeployment Protectionが有効な場合は、先にVercelへのログインが求められることがあります。これはアプリ内のパスワードとは別のアクセス制限です。

## 5. Safariで保存を確認

1. 一人を選び「目標・アクション」を編集し、サンプルの文を追記して保存します。
2. ページを再読み込みし、再度ログインします。保存した内容が残っていることを確認します。
3. 売上を入力して達成率・客単価が変わること、評価・面談を追加して履歴に残ることを確認します。
4. 可能ならVercelで再デプロイ後にも同じ内容が保持されることを確認します。Supabaseの `staff` テーブルでも保存内容を確認できます。
5. Safariの共有メニューから「ホーム画面に追加」を選ぶと、iPadのホーム画面から開けます。オンライン利用が必要です（オフラインアプリではありません）。

アプリのパスワードはメモリ内だけに保持し、ページ再読み込み・ログアウト後には再入力が必要です。パスワードを変更したい場合はVercelの環境変数を変更して再デプロイします。

## 困ったとき

- **ログインできない**: `ADMIN_PASSWORD` の空白・大文字小文字・16文字以上を確認し、変更後にRedeployします。
- **「設定が未完了」**: 環境変数3つが、閲覧中のProduction/Previewに設定されているか確認します。設定後にRedeployします。
- **「データベースに接続できませんでした」**: Supabaseが稼働中か、URLとservice_roleキーが同じプロジェクトか、`setup.sql` 実行済みかを確認します。Supabase側の制限や休止も確認してください。
- **ビルドエラー**: FrameworkがOther、Rootがリポジトリルート、Build CommandとOutputが上記の値か確認します。VercelのBuild Logsで最初のエラーを確認します。キーの値を共有しないでください。
- **「更新の競合」**: 別の画面で更新された可能性があります。編集中の文章を控えてからページを再読み込みし、最新の内容に再入力します。
- **データを守る**: Supabaseの削除・リセットはデータを失います。無料プランのバックアップ・休止条件を確認し、必要なバックアップを別途確保してください。

## 試用版の範囲

単独管理者向けの共有パスワード方式です。個人アカウント、店舗別権限、MFA、監査ログ、アプリ内のレート制限は未実装です。実際の氏名・売上・面談内容の運用に移る前に、Supabase Authなどによる個人認証、権限、バックアップ運用を追加してください。

実行環境をローカルのSQLite版からVercelへ切り替えても、SQLiteのデータを自動送信しません。クラウドにはSQLで作った架空データのみを登録します。
