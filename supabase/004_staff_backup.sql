-- 店舗移行前のスタッフ全件を書き出すための読み取り専用SQLです。
-- このSQLは結果を表示するだけです。結果をCSVとして保存してください。
-- data列には売上・目標・スキル・面談を含むカルテ全体が入っています。
-- LIMITや条件による絞り込みをせず、実行時点の全行・全列を取得します。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT *
FROM public.staff
ORDER BY id;

COMMIT;
