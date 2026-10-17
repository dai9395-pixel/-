-- 店舗管理の追加。既存環境ではこのファイルだけを適用します。
-- staff.data（売上・目標・スキル・面談）と既存versionを保持します。
-- 最終確認版 v2（2026-10-17）。全文を一つのクエリで実行します。
BEGIN;
-- ロック待ちや処理が長引いた場合は、変更を確定せず中止します。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public.staff IN SHARE ROW EXCLUSIVE MODE;

-- 元のカルテ全体を一時的に控えます。正常終了時に一時表は自動消去されます。
-- 本番のスタッフ行やバックアップファイルを削除する処理ではありません。
CREATE TEMP TABLE karte_stores_original_staff ON COMMIT DROP AS
SELECT id, data, version, to_jsonb(s)->>'store_id' AS original_store_id
FROM public.staff s;
CREATE TEMP TABLE karte_stores_original_sales_links (
  staff_id bigint, month text, store_id bigint
) ON COMMIT DROP;
DO $snapshot_existing_links$
BEGIN
  IF to_regclass('public.staff_sales_stores') IS NOT NULL THEN
    EXECUTE 'INSERT INTO karte_stores_original_sales_links SELECT staff_id, month, store_id FROM public.staff_sales_stores';
  END IF;
END $snapshot_existing_links$;

-- 売上の集計先が欠けたまま移行することを防ぎます。元データは書き換えません。
DO $preflight$
BEGIN
  IF to_regprocedure('public.is_karte_admin()') IS NULL THEN
    RAISE EXCEPTION '管理者認証が未設定です。既存データは変更せず中止します。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff
    WHERE data ? 'sales' AND jsonb_typeof(data->'sales') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION '売上データの形式を確認してください。既存データは変更せず中止します。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff s,
    LATERAL jsonb_array_elements(COALESCE(s.data->'sales', '[]'::jsonb)) entry
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR entry->>'month' IS NULL
       OR entry->>'month' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  ) THEN
    RAISE EXCEPTION '売上の対象月を確認してください。既存データは変更せず中止します。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff s,
    LATERAL jsonb_array_elements(COALESCE(s.data->'sales', '[]'::jsonb)) entry
    GROUP BY s.id, entry->>'month' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '同じ月の売上が重複しています。既存データは変更せず中止します。';
  END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.stores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stores_name_unique ON public.stores (lower(name));
-- 同名の無関係な索引があって作成をスキップした場合は、そのまま進めません。
DO $verify_store_unique_index$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid=to_regclass('public.stores_name_unique')
      AND indrelid='public.stores'::regclass AND indisunique AND indisvalid
      AND indnkeyatts=1 AND indpred IS NULL
      AND pg_get_expr(indexprs, indrelid)='lower(name)'
  ) THEN
    RAISE EXCEPTION '店舗名の重複防止索引が想定と異なります。既存データを変更せず中止します。';
  END IF;
END $verify_store_unique_index$;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS store_id bigint;

-- 初回のみ既存の店舗名を取り込みます。再実行で改名前の店舗は復活しません。
INSERT INTO public.stores(name)
SELECT min(COALESCE(NULLIF(btrim(data->>'store'), ''), '未設定'))
FROM public.staff WHERE store_id IS NULL
GROUP BY lower(COALESCE(NULLIF(btrim(data->>'store'), ''), '未設定'))
ON CONFLICT DO NOTHING;

UPDATE public.staff AS s SET store_id = t.id
FROM public.stores AS t
WHERE s.store_id IS NULL
  AND lower(COALESCE(NULLIF(btrim(s.data->>'store'), ''), '未設定')) = lower(t.name);

DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.staff'::regclass AND conname='staff_store_id_fkey') THEN
    ALTER TABLE public.staff ADD CONSTRAINT staff_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE RESTRICT;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.staff'::regclass AND conname='staff_store_id_fkey'
      AND contype='f' AND confrelid='public.stores'::regclass AND confdeltype='r' AND convalidated
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.staff'::regclass AND attname='store_id' AND NOT attisdropped)]::smallint[]
      AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.stores'::regclass AND attname='id' AND NOT attisdropped)]::smallint[]
  ) THEN
    RAISE EXCEPTION '既存の店舗IDの外部キーが想定と異なります。変更を確定せず中止します。';
  END IF;
END $constraint$;
ALTER TABLE public.staff ALTER COLUMN store_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS staff_store_id_idx ON public.staff(store_id);

-- 売上金額は従来どおりstaff.dataに保持。月ごとの集計先だけを記録します。
CREATE TABLE IF NOT EXISTS public.staff_sales_stores (
  staff_id bigint NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  store_id bigint NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  PRIMARY KEY (staff_id, month)
);
CREATE INDEX IF NOT EXISTS sales_store_month_idx ON public.staff_sales_stores(store_id, month);
INSERT INTO public.staff_sales_stores(staff_id, month, store_id)
SELECT s.id, entry->>'month', s.store_id
FROM public.staff s,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'sales')='array' THEN s.data->'sales' ELSE '[]'::jsonb END) entry
WHERE entry->>'month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
ON CONFLICT DO NOTHING;

-- 新しい所属への設定は有効店舗のみ。既存の無効店舗でのカルテ編集は許可。
CREATE OR REPLACE FUNCTION public.validate_staff_store()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE chosen_active boolean;
BEGIN
  IF NEW.store_id IS NULL THEN
    SELECT id INTO NEW.store_id FROM public.stores
    WHERE lower(name) = lower(btrim(NEW.data->>'store'));
  ELSIF TG_OP = 'UPDATE' THEN
    -- 旧版API（store_idを送らず店舗名だけを更新）にも互換性を保ちます。
    IF NEW.store_id = OLD.store_id AND NEW.data->>'store' IS DISTINCT FROM OLD.data->>'store' THEN
      SELECT id INTO NEW.store_id FROM public.stores
      WHERE lower(name) = lower(btrim(NEW.data->>'store'));
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT active INTO chosen_active FROM public.stores WHERE id=NEW.store_id FOR SHARE;
    IF chosen_active IS DISTINCT FROM true THEN RAISE EXCEPTION '有効な所属店舗を選択してください' USING ERRCODE='23514'; END IF;
  ELSIF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    SELECT active INTO chosen_active FROM public.stores WHERE id=NEW.store_id FOR SHARE;
    IF chosen_active IS DISTINCT FROM true THEN RAISE EXCEPTION '無効な店舗へは異動できません' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.version := OLD.version + 1; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_staff_store() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS validate_staff_store ON public.staff;
CREATE TRIGGER validate_staff_store BEFORE INSERT OR UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.validate_staff_store();

CREATE OR REPLACE FUNCTION public.capture_sales_store()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.staff_sales_stores(staff_id, month, store_id)
  SELECT NEW.id, entry->>'month', NEW.store_id
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.data->'sales')='array' THEN NEW.data->'sales' ELSE '[]'::jsonb END) entry
  WHERE entry->>'month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_sales_store() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_sales_store ON public.staff;
CREATE TRIGGER capture_sales_store AFTER INSERT OR UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.capture_sales_store();

CREATE OR REPLACE FUNCTION public.bump_store_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.bump_store_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bump_store_version ON public.stores;
CREATE TRIGGER bump_store_version BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.bump_store_version();

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_sales_stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stores, public.staff_sales_stores FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stores TO authenticated;
REVOKE ALL ON SEQUENCE public.stores_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.stores_id_seq TO authenticated;
GRANT SELECT ON public.staff_sales_stores TO authenticated;
DROP POLICY IF EXISTS stores_admin_read ON public.stores;
DROP POLICY IF EXISTS stores_admin_insert ON public.stores;
DROP POLICY IF EXISTS stores_admin_update ON public.stores;
DROP POLICY IF EXISTS sales_stores_admin_read ON public.staff_sales_stores;
DROP POLICY IF EXISTS stores_admin_guard ON public.stores;
DROP POLICY IF EXISTS sales_stores_admin_guard ON public.staff_sales_stores;
-- 他の許可ポリシーが存在しても、管理者条件を迂回させません。
CREATE POLICY stores_admin_guard ON public.stores AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_karte_admin())) WITH CHECK ((SELECT public.is_karte_admin()));
CREATE POLICY sales_stores_admin_guard ON public.staff_sales_stores AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_karte_admin())) WITH CHECK ((SELECT public.is_karte_admin()));
CREATE POLICY stores_admin_read ON public.stores FOR SELECT TO authenticated USING ((SELECT public.is_karte_admin()));
CREATE POLICY stores_admin_insert ON public.stores FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_karte_admin()));
CREATE POLICY stores_admin_update ON public.stores FOR UPDATE TO authenticated USING ((SELECT public.is_karte_admin())) WITH CHECK ((SELECT public.is_karte_admin()));
CREATE POLICY sales_stores_admin_read ON public.staff_sales_stores FOR SELECT TO authenticated USING ((SELECT public.is_karte_admin()));
-- DELETE権限・DELETEポリシーは付与しません。店舗はactive=falseで無効化します。
-- 確定時の遅延トリガー・遅延制約も先に実行し、その結果を含めて照合します。
SET CONSTRAINTS ALL IMMEDIATE;
-- 元の全スタッフと照合。不一致ならCOMMITせず、追加した変更も取り消します。
-- 独自の既存トリガーが売上や目標、versionを変更した場合もここで検出します。
DO $preserve_staff$
BEGIN
  IF EXISTS (
    SELECT id, data::text COLLATE "C", version FROM public.staff
    EXCEPT
    SELECT id, data::text COLLATE "C", version FROM karte_stores_original_staff
  ) OR EXISTS (
    SELECT id, data::text COLLATE "C", version FROM karte_stores_original_staff
    EXCEPT
    SELECT id, data::text COLLATE "C", version FROM public.staff
  ) THEN
    RAISE EXCEPTION '元のスタッフ記録との差異を検出しました。全変更を取り消すため、COMMITしません。';
  END IF;
END $preserve_staff$;
-- 元から設定済みの店舗IDは維持し、初回補完分は元の店舗名との対応を確認します。
DO $preserve_store_ids$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.staff s
    JOIN karte_stores_original_staff original ON original.id=s.id
    LEFT JOIN public.stores t ON t.id=s.store_id
    WHERE t.id IS NULL OR (
      original.original_store_id IS NOT NULL
      AND s.store_id IS DISTINCT FROM original.original_store_id::bigint
    ) OR (
      original.original_store_id IS NULL
      AND lower(t.name) IS DISTINCT FROM lower(COALESCE(NULLIF(btrim(original.data->>'store'), ''), '未設定'))
    )
  ) THEN
    RAISE EXCEPTION '店舗IDの想定外の変更を検出しました。全変更を確定せず中止します。';
  END IF;
END $preserve_store_ids$;
DO $preserve_existing_sales_links$
BEGIN
  IF EXISTS (
    SELECT staff_id, month, store_id FROM karte_stores_original_sales_links
    EXCEPT
    SELECT staff_id, month, store_id FROM public.staff_sales_stores
  ) THEN
    RAISE EXCEPTION '既存の売上集計先の変更を検出しました。全変更を確定せず中止します。';
  END IF;
END $preserve_existing_sales_links$;
NOTIFY pgrst, 'reload schema';
COMMIT;
