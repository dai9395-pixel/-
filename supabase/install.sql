-- 最初にこのファイル全体をSQL Editorで実行してください。
-- 架空データ作成と認証・RLS設定を一つのトランザクションで行います。
BEGIN;
-- Supabase SQL Editorで実行。架空スタッフ15名のみを登録します。
-- 再実行しても既存データを上書き・再投入しません。
CREATE TABLE IF NOT EXISTS public.staff (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff FROM anon, authenticated;
GRANT ALL ON public.staff TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.staff_id_seq TO service_role;
CREATE TABLE IF NOT EXISTS public.karte_metadata (key text PRIMARY KEY);
ALTER TABLE public.karte_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.karte_metadata FROM anon, authenticated;
DO $seed$
DECLARE
 names text[] := ARRAY['青山 はるか','橘 蓮','白石 みお','藤井 そら','水野 あおい','森 ひなた','小林 なぎ','高橋 りつ','中村 つむぎ','佐藤 いおり','山本 ゆう','石田 かえで','井上 さく','松本 りお','吉田 こと'];
 stores text[] := ARRAY['表参道店','代官山店','自由が丘店'];
 roles text[] := ARRAY['スタイリスト','トップスタイリスト','アシスタント'];
 i integer;
 sales jsonb;
 stamp text := to_char(current_date, 'YYYY-MM-01');
 previous_stamp text := to_char(current_date - interval '1 month', 'YYYY-MM-01');
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.karte_metadata WHERE key='sample-v1') THEN
  FOR i IN 0..14 LOOP
   SELECT jsonb_agg(jsonb_build_object(
    'month',to_char(current_date - back * interval '1 month','YYYY-MM'),
    'target',1000000,'actual',650000+i*23000+(5-back)*42000,
    'nominated',round((650000+i*23000+(5-back)*42000)*0.72),
    'customers',70+i*2
   ) ORDER BY back DESC) INTO sales FROM generate_series(0,5) AS back;
   INSERT INTO public.staff(data) VALUES (jsonb_build_object(
    'name',names[i+1],'store',stores[i%3+1],'role',roles[i%3+1],
    'vision','お客様の毎日に、自信と笑顔を届けられる美容師へ。',
    'annual','指名のお客様を増やし、信頼されるスタイリストになる',
    'monthly','再来店につながるカウンセリングを実践する',
    'challenge','お客様のライフスタイルを深く理解する',
    'action','施術前に悩みを3つ伺い、次回の提案まで伝える',
    'progress',60+i%4*10,'sales',sales,
    'skills',jsonb_build_array(
     jsonb_build_object('date',previous_stamp,'scores',jsonb_build_array(2,3,3,3,2,2)),
     jsonb_build_object('date',stamp,'scores',jsonb_build_array(3+i%2,4,3,4,3,2+i%3))
    ),
    'interviews',jsonb_build_array(jsonb_build_object(
     'date',stamp,'worry','提案に自信が持てないことがある',
     'challenge','カウンセリングの引き出しを増やす',
     'feedback','丁寧な聞き取りが強み。小さな成功体験を一緒に増やしていきましょう。',
     'next','週に1回、先輩と提案のロールプレイを行う'
    ))
   ));
  END LOOP;
  INSERT INTO public.karte_metadata VALUES ('sample-v1');
 END IF;
END $seed$;
-- setup.sqlの後に実行。既存のスタッフデータは変更・削除しません。
-- このアプリのstaffテーブルのポリシーを、管理者限定へ統一します。
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
