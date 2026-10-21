-- 本番の読み取り確認専用。004_stores.sqlとは別の新しいクエリへ貼り付けます。
-- 関数経由の書き込みも拒否する、読み取り専用トランザクションです。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH targets AS (
  SELECT v.schema_name, v.table_name, c.oid, c.relrowsecurity,
         c.relforcerowsecurity, c.relowner
  FROM (VALUES
    ('public','staff'), ('public','karte_admins'),
    ('public','karte_metadata'), ('public','stores'),
    ('public','staff_sales_stores'), ('auth','users')
  ) AS v(schema_name,table_name)
  LEFT JOIN pg_namespace n ON n.nspname=v.schema_name
  LEFT JOIN pg_class c ON c.relnamespace=n.oid
    AND c.relname=v.table_name AND c.relkind IN ('r','p')
), checks AS (
  SELECT 10 AS display_order, '実行環境'::text AS category,
    '接続ロール'::text AS item, current_user::text AS result
  UNION ALL
  SELECT 11,'実行環境','読み取り専用',current_setting('transaction_read_only')
  UNION ALL
  SELECT 12,'実行環境','staff件数の確認範囲',CASE WHEN EXISTS (
    SELECT 1 FROM pg_roles r JOIN targets t ON t.table_name='staff' AND t.schema_name='public'
    WHERE r.rolname=current_user AND (
      r.rolsuper OR r.rolbypassrls OR NOT t.relrowsecurity
      OR (t.relowner=r.oid AND NOT t.relforcerowsecurity)
    )
  ) THEN '全件を確認できるロール' ELSE 'RLSにより一部だけ表示の可能性・要確認' END
  UNION ALL
  SELECT 20,'正確な件数',schema_name||'.'||table_name,
    CASE WHEN oid IS NULL THEN '未作成'
    WHEN NOT has_table_privilege(current_user,oid,'SELECT') THEN '読み取り権限なし'
    ELSE (xpath('/row/n/text()',query_to_xml(
      format('SELECT count(*) AS n FROM %I.%I',schema_name,table_name),
      false,true,'')))[1]::text END
  FROM targets
  UNION ALL
  SELECT 30,'カルテ','元データ確認コード',md5(coalesce(string_agg(
    id::text||':'||version::text||':'||data::text,E'\n' ORDER BY id
  ),'')) FROM public.staff
  UNION ALL
  SELECT 31,'カルテ','売上記録数',coalesce(sum(CASE
    WHEN jsonb_typeof(data->'sales')='array'
    THEN jsonb_array_length(data->'sales') ELSE 0 END),0)::text FROM public.staff
  UNION ALL
  SELECT 32,'カルテ','スキル評価記録数',coalesce(sum(CASE
    WHEN jsonb_typeof(data->'skills')='array'
    THEN jsonb_array_length(data->'skills') ELSE 0 END),0)::text FROM public.staff
  UNION ALL
  SELECT 33,'カルテ','面談記録数',coalesce(sum(CASE
    WHEN jsonb_typeof(data->'interviews')='array'
    THEN jsonb_array_length(data->'interviews') ELSE 0 END),0)::text FROM public.staff
  UNION ALL
  SELECT 34,'カルテ','目標関連の全項目を持つスタッフ数',count(*) FILTER (
    WHERE data ?& ARRAY['vision','annual','monthly','challenge','action','progress']
  )::text FROM public.staff
  UNION ALL
  SELECT 35,'カルテ','スタッフIDの重複件数',(count(*)-count(DISTINCT id))::text FROM public.staff
  UNION ALL
  SELECT 40,'RLS',schema_name||'.'||table_name,CASE
    WHEN oid IS NULL THEN '未作成'
    WHEN relrowsecurity THEN '有効'
    ELSE '無効・要確認' END
  FROM targets WHERE schema_name='public'
  UNION ALL
  SELECT 50,'テーブル権限（RLS適用前）',t.schema_name||'.'||t.table_name||' / '||r.role_name,
    CASE WHEN t.oid IS NULL THEN '未作成' ELSE format(
      'SELECT=%s / INSERT=%s / UPDATE=%s / DELETE=%s',
      has_table_privilege(r.role_name,t.oid,'SELECT'),
      has_table_privilege(r.role_name,t.oid,'INSERT'),
      has_table_privilege(r.role_name,t.oid,'UPDATE'),
      has_table_privilege(r.role_name,t.oid,'DELETE')) END
  FROM targets t CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
  WHERE t.schema_name='public'
  UNION ALL
  SELECT 60,'管理者権限','管理者関数の内容確認',CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.is_karte_admin()')
      AND p.prosecdef AND p.provolatile='s'
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND regexp_replace(lower(p.prosrc),'[[:space:]]','','g')=
        'selectexists(select1frompublic.karte_adminswhereuser_id=(selectauth.uid())andactive=true);'
  ) THEN 'OK' ELSE '未設定または標準実装と異なる・要確認' END
  UNION ALL
  SELECT 61,'管理者権限','管理者関数の実行権限',CASE
    WHEN to_regprocedure('public.is_karte_admin()') IS NULL THEN '未設定'
    ELSE format('anon=%s / authenticated=%s',
      has_function_privilege('anon',to_regprocedure('public.is_karte_admin()'),'EXECUTE'),
      has_function_privilege('authenticated',to_regprocedure('public.is_karte_admin()'),'EXECUTE')) END
  UNION ALL
  SELECT 62,'管理者権限','有効な管理者数',CASE
    WHEN to_regclass('public.karte_admins') IS NULL THEN '未設定'
    WHEN NOT has_table_privilege(current_user,'public.karte_admins','SELECT') THEN '読み取り権限なし'
    ELSE (xpath('/row/n/text()',query_to_xml(
      'SELECT count(*) AS n FROM public.karte_admins WHERE active=true',false,true,'')))[1]::text END
  UNION ALL
  SELECT 70,'RLSポリシー',schemaname||'.'||tablename||' / '||policyname,
    concat_ws(' | ',permissive,cmd,roles::text,qual,with_check)
  FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('staff','karte_admins','karte_metadata','stores','staff_sales_stores')
  UNION ALL
  SELECT 80,'トリガー',n.nspname||'.'||c.relname||' / '||t.tgname,
    format('状態=%s / 関数=%s / 遅延可能=%s / 初期遅延=%s / 関数照合コード=%s',
      t.tgenabled,t.tgfoid::regprocedure,t.tgdeferrable,t.tginitdeferred,
      md5(pg_get_functiondef(t.tgfoid)))
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
  UNION ALL
  SELECT 81,'トリガー','ユーザー定義トリガー数',count(*)::text
  FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL
  SELECT 90,'DDLイベントトリガー',evtname,
    format('状態=%s / イベント=%s / 関数=%s / 関数照合コード=%s',
      evtenabled,evtevent,evtfoid::regprocedure,md5(pg_get_functiondef(evtfoid)))
  FROM pg_event_trigger
  UNION ALL
  SELECT 91,'DDLイベントトリガー','登録数',count(*)::text FROM pg_event_trigger
)
SELECT category AS "区分",item AS "確認項目",result AS "結果"
FROM checks ORDER BY display_order,item;

COMMIT;
