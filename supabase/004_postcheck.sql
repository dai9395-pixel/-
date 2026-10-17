-- 店舗移行後の読み取り確認専用。新しいクエリで全文を実行します。
-- 以前の確認CSV取得後にカルテを編集した場合、照合コードは変わります。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH original AS (
  SELECT count(*) AS staff_count,
    md5(coalesce(string_agg(
      id::text || ':' || version::text || ':' || data::text,
      E'\n' ORDER BY id
    ), '')) AS checksum
  FROM public.staff
), sales AS (
  SELECT s.id AS staff_id, e->>'month' AS month, e
  FROM public.staff s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s.data->'sales')='array'
      THEN s.data->'sales' ELSE '[]'::jsonb END
  ) e
), checks AS (
  SELECT 10 AS ord, '実行環境'::text AS category,
    '接続ロール'::text AS item, current_user::text AS result
  UNION ALL
  SELECT 11,'実行環境','読み取り専用',current_setting('transaction_read_only')
  UNION ALL
  SELECT 20,'カルテ','スタッフ人数',staff_count::text FROM original
  UNION ALL
  SELECT 21,'カルテ','元データ確認コード',checksum FROM original
  UNION ALL
  SELECT 22,'カルテ','移行前の確認コードとの比較',CASE
    WHEN checksum='99621cea69c5b6bedaafe34b44b41586' THEN '一致'
    ELSE '不一致・要確認（確認CSV取得後の編集でも変わります）'
  END FROM original
  UNION ALL
  SELECT 23,'カルテ','売上記録数',count(*)::text FROM sales
  UNION ALL
  SELECT 24,'カルテ','スキル評価記録数',coalesce(sum(CASE
    WHEN jsonb_typeof(data->'skills')='array'
    THEN jsonb_array_length(data->'skills') ELSE 0 END),0)::text FROM public.staff
  UNION ALL
  SELECT 25,'カルテ','面談記録数',coalesce(sum(CASE
    WHEN jsonb_typeof(data->'interviews')='array'
    THEN jsonb_array_length(data->'interviews') ELSE 0 END),0)::text FROM public.staff
  UNION ALL
  SELECT 26,'カルテ','目標関連の全項目を持つスタッフ数',count(*) FILTER (
    WHERE data ?& ARRAY['vision','annual','monthly','challenge','action','progress']
  )::text FROM public.staff
  UNION ALL
  SELECT 27,'カルテ','記録配列の形式不正件数',count(*)::text FROM public.staff
  WHERE jsonb_typeof(data->'sales') IS DISTINCT FROM 'array'
     OR jsonb_typeof(data->'skills') IS DISTINCT FROM 'array'
     OR jsonb_typeof(data->'interviews') IS DISTINCT FROM 'array'
  UNION ALL
  SELECT 30,'店舗の対応','登録店舗数',count(*)::text FROM public.stores
  UNION ALL
  SELECT 31,'店舗の対応','店舗未設定のスタッフ数',count(*)::text
  FROM public.staff WHERE store_id IS NULL
  UNION ALL
  SELECT 32,'店舗の対応','存在しない店舗への所属件数',count(*)::text
  FROM public.staff s LEFT JOIN public.stores t ON t.id=s.store_id
  WHERE s.store_id IS NOT NULL AND t.id IS NULL
  UNION ALL
  SELECT 33,'店舗の対応','月別売上の店舗対応件数',count(*)::text
  FROM public.staff_sales_stores
  UNION ALL
  SELECT 34,'店舗の対応','店舗対応がない売上記録数',count(*)::text
  FROM sales s LEFT JOIN public.staff_sales_stores m
    ON m.staff_id=s.staff_id AND m.month=s.month
  WHERE m.staff_id IS NULL
  UNION ALL
  SELECT 35,'店舗の対応','参照先が存在しない月別対応件数',count(*)::text
  FROM public.staff_sales_stores m
  LEFT JOIN public.staff s ON s.id=m.staff_id
  LEFT JOIN public.stores t ON t.id=m.store_id
  WHERE s.id IS NULL OR t.id IS NULL
  UNION ALL
  SELECT 36,'店舗の対応','月別対応の重複件数',count(*)::text FROM (
    SELECT staff_id,month FROM public.staff_sales_stores
    GROUP BY staff_id,month HAVING count(*)>1
  ) duplicates
  UNION ALL
  SELECT 40,'店舗一覧','店舗ID '||t.id,
    jsonb_build_object('店舗名',t.name,'有効',t.active,
      '現在の所属人数',(SELECT count(*) FROM public.staff s WHERE s.store_id=t.id)
    )::text FROM public.stores t
  UNION ALL
  SELECT 50,'RLS',v.table_name,CASE WHEN c.oid IS NULL THEN '未作成'
    WHEN c.relrowsecurity THEN '有効' ELSE '無効・要確認' END
  FROM (VALUES ('staff'),('karte_admins'),('stores'),('staff_sales_stores')) v(table_name)
  LEFT JOIN pg_namespace n ON n.nspname='public'
  LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=v.table_name
  UNION ALL
  SELECT 51,'テーブル権限（RLS適用前）',v.table_name||' / '||r.role_name,
    format('SELECT=%s / INSERT=%s / UPDATE=%s / DELETE=%s',
      has_table_privilege(r.role_name,'public.'||v.table_name,'SELECT'),
      has_table_privilege(r.role_name,'public.'||v.table_name,'INSERT'),
      has_table_privilege(r.role_name,'public.'||v.table_name,'UPDATE'),
      has_table_privilege(r.role_name,'public.'||v.table_name,'DELETE'))
  FROM (VALUES ('staff'),('karte_admins'),('stores'),('staff_sales_stores')) v(table_name)
  CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
  UNION ALL
  SELECT 52,'RLSポリシー',tablename||' / '||policyname,
    concat_ws(' | ',permissive,cmd,roles::text,qual,with_check)
  FROM pg_policies WHERE schemaname='public'
    AND tablename IN ('staff','karte_admins','stores','staff_sales_stores')
  UNION ALL
  SELECT 53,'管理者','有効管理者数',count(*)::text
  FROM public.karte_admins WHERE active=true
  UNION ALL
  SELECT 60,'必要なトリガー',v.table_name||' / '||v.trigger_name,CASE
    WHEN t.oid IS NULL THEN '未設定・要確認'
    ELSE format('状態=%s / 関数=%s',t.tgenabled,t.tgfoid::regprocedure) END
  FROM (VALUES
    ('staff','validate_staff_store'),('staff','capture_sales_store'),
    ('stores','bump_store_version')
  ) v(table_name,trigger_name)
  LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||v.table_name)
    AND t.tgname=v.trigger_name AND NOT t.tgisinternal
)
SELECT category AS "区分",item AS "確認項目",result AS "結果"
FROM checks ORDER BY ord,item;

COMMIT;
