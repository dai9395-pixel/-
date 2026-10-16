-- Authentication > Usersで作成した管理者のメールへ置き換えて実行。
-- SQL Editor以外（アプリ・ブラウザーAPI）からは実行できません。
DO $admin$
DECLARE target uuid;
BEGIN
 SELECT id INTO target FROM auth.users WHERE lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL');
 IF target IS NULL THEN
  RAISE EXCEPTION '先にAuthentication > Usersで管理者ユーザーを作成し、このSQL内のメールアドレスを置き換えてください。';
 END IF;
 INSERT INTO public.karte_admins(user_id,active) VALUES (target,true)
 ON CONFLICT (user_id) DO UPDATE SET active=true;
END $admin$;
