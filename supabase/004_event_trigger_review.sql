-- DDLイベントトリガーの処理本文を確認するための読み取り専用SQL。
-- 004_stores.sqlとは別のクエリです。利用者の確認・了承後に実行します。
-- 関数を呼び出したり、トリガーを無効化したりする処理はありません。
-- 結果には関数本文が含まれます。独自に外部接続情報などを埋め込んだ
-- 関数がある場合、秘密情報を含む結果をそのまま共有しないでください。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT
  e.evtname AS "イベントトリガー名",
  e.evtevent AS "実行タイミング",
  e.evtenabled AS "状態",
  e.evttags AS "対象SQLの種類",
  n.nspname AS "関数スキーマ",
  p.proname AS "関数名",
  pg_get_userbyid(p.proowner) AS "関数所有者",
  p.prosecdef AS "所有者権限で実行",
  p.proconfig AS "関数設定",
  md5(pg_get_functiondef(p.oid)) AS "関数照合コード",
  pg_get_functiondef(p.oid) AS "処理本文"
FROM pg_event_trigger e
JOIN pg_proc p ON p.oid=e.evtfoid
JOIN pg_namespace n ON n.oid=p.pronamespace
ORDER BY e.evtname;

COMMIT;
