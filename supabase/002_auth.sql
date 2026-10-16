-- setup.sqlの後に実行。既存のスタッフデータは変更・削除しません。
-- このアプリのstaffテーブルのポリシーを、管理者限定へ統一します。
BEGIN;
CREATE TABLE IF NOT EXISTS public.karte_admins (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.karte_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.karte_admins FROM PUBLIC, anon, authenticated;
-- 自分を管理者に昇格するAPIは用意しません。SQL Editorからのみ登録します。
CREATE OR REPLACE FUNCTION public.is_karte_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.karte_admins
  WHERE user_id = (SELECT auth.uid()) AND active = true
 );
$$;
REVOKE ALL ON FUNCTION public.is_karte_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_karte_admin() TO authenticated;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
REVOKE ALL ON SEQUENCE public.staff_id_seq FROM PUBLIC, anon;
GRANT USAGE, SELECT ON SEQUENCE public.staff_id_seq TO authenticated;
-- PostgreSQLの許可ポリシーはORで合成されるため、古い緩いポリシーも除去します。
DO $policies$
DECLARE p record;
BEGIN
 FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('staff','karte_admins') LOOP
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='staff' AND policyname=p.policyname) THEN
   EXECUTE format('DROP POLICY IF EXISTS %I ON public.staff',p.policyname);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='karte_admins' AND policyname=p.policyname) THEN
   EXECUTE format('DROP POLICY IF EXISTS %I ON public.karte_admins',p.policyname);
  END IF;
 END LOOP;
END $policies$;
CREATE POLICY staff_admin_read ON public.staff FOR SELECT TO authenticated USING ((SELECT public.is_karte_admin()));
CREATE POLICY staff_admin_insert ON public.staff FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_karte_admin()));
CREATE POLICY staff_admin_update ON public.staff FOR UPDATE TO authenticated USING ((SELECT public.is_karte_admin())) WITH CHECK ((SELECT public.is_karte_admin()));
CREATE POLICY staff_admin_delete ON public.staff FOR DELETE TO authenticated USING ((SELECT public.is_karte_admin()));
-- 旧サーバーキー経由でのアプリ利用を廃止。Vercel側のキーも削除してください。
REVOKE ALL ON public.staff FROM service_role;
REVOKE ALL ON SEQUENCE public.staff_id_seq FROM service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
