-- Supabase SQL Editorで実行。架空スタッフ15名のみを登録します。
-- 再実行しても既存データを上書き・再投入しません。
BEGIN;
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
COMMIT;
