-- 読み取り専用の事前確認。データ・権限・設定を変更しません。
SELECT 'スタッフ人数' AS check_name, count(*)::text AS result
FROM public.staff
UNION ALL
SELECT '元データ確認コード', md5(coalesce(string_agg(
  id::text || ':' || version::text || ':' || data::text,
  E'\n' ORDER BY id
), '')) FROM public.staff
UNION ALL
SELECT 'staffのRLS', CASE WHEN relrowsecurity THEN '有効' ELSE '無効・要確認' END
FROM pg_class WHERE oid=to_regclass('public.staff')
UNION ALL
SELECT '管理者一覧のRLS', CASE WHEN relrowsecurity THEN '有効' ELSE '無効・要確認' END
FROM pg_class WHERE oid=to_regclass('public.karte_admins')
UNION ALL
SELECT '管理者一覧への一般書き込み拒否', CASE
  WHEN to_regclass('public.karte_admins') IS NULL THEN '未設定・要確認'
  WHEN NOT has_table_privilege('authenticated', 'public.karte_admins', 'INSERT,UPDATE,DELETE')
   AND NOT has_table_privilege('anon', 'public.karte_admins', 'INSERT,UPDATE,DELETE') THEN 'OK'
  ELSE '要確認' END
UNION ALL
SELECT '管理者関数の内容確認', CASE WHEN EXISTS (
  SELECT 1 FROM pg_proc p
  WHERE p.oid=to_regprocedure('public.is_karte_admin()')
    AND p.prosecdef AND p.provolatile='s'
    AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql')
    AND p.proconfig @> ARRAY['search_path=""']::text[]
    AND regexp_replace(lower(p.prosrc), '[[:space:]]', '', 'g')=
      'selectexists(select1frompublic.karte_adminswhereuser_id=(selectauth.uid())andactive=true);'
) THEN 'OK' ELSE '要確認' END
UNION ALL
SELECT 'staff権限: ' || policyname,
  concat_ws(' | ', permissive, cmd, roles::text, qual, with_check)
FROM pg_policies WHERE schemaname='public' AND tablename='staff';
