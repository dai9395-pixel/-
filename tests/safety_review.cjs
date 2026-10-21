// Local-only test: never uses a Supabase URL, credential or production database.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {readFileSync}=require('node:fs');const {join}=require('node:path');const assert=require('node:assert/strict');
const sql=name=>readFileSync(join(__dirname,'../supabase',name),'utf8');
(async()=>{const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001','admin@example.test');`);
 await db.exec(sql('install.sql'));await db.exec(sql('003_add_admin.sql').replace('REPLACE_WITH_ADMIN_EMAIL','admin@example.test'));
 const before=(await db.query('SELECT id,data,version FROM public.staff ORDER BY id')).rows;
 const schema=async()=>(await db.query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname")).rows;
 const beforeSchema=await schema();
 const script=sql('004_safety_review.sql');const results=await db.exec(script);const checks=results.flatMap(result=>result.rows||[]);
 const find=(category,item)=>checks.find(r=>r['区分']===category&&r['確認項目']===item)?.['結果'];
 assert.equal(find('実行環境','読み取り専用'),'on');assert.equal(find('正確な件数','public.staff'),'15');
 assert.equal(find('実行環境','staff件数の確認範囲'),'全件を確認できるロール');
 assert.equal(find('正確な件数','public.stores'),'未作成');assert.equal(find('正確な件数','public.staff_sales_stores'),'未作成');
 assert.equal(find('カルテ','売上記録数'),'90');assert.equal(find('カルテ','スキル評価記録数'),'30');assert.equal(find('カルテ','面談記録数'),'15');
 assert.equal(find('カルテ','目標関連の全項目を持つスタッフ数'),'15');assert.equal(find('カルテ','スタッフIDの重複件数'),'0');
 assert.equal(find('管理者権限','管理者関数の内容確認'),'OK');assert.equal(find('管理者権限','有効な管理者数'),'1');
 assert.deepEqual((await db.query('SELECT id,data,version FROM public.staff ORDER BY id')).rows,before);assert.deepEqual(await schema(),beforeSchema);
 let blocked=false;try{await db.exec('BEGIN TRANSACTION READ ONLY; UPDATE public.staff SET version=version+1; COMMIT;')}catch(error){blocked=error.code==='25006';await db.exec('ROLLBACK')}
 assert.ok(blocked,'Read-only mode must reject permanent writes');assert.deepEqual((await db.query('SELECT id,data,version FROM public.staff ORDER BY id')).rows,before);
 await db.exec(`CREATE FUNCTION public.test_secret_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW;END $$;
 CREATE TRIGGER test_secret_trigger AFTER UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.test_secret_trigger('do-not-display-this-private-trigger-argument');`);
 const withTrigger=(await db.exec(script)).flatMap(r=>r.rows||[]);assert.equal(JSON.stringify(withTrigger).includes('do-not-display-this-private-trigger-argument'),false);assert.ok(withTrigger.some(r=>r['区分']==='トリガー'&&r['確認項目'].includes('test_secret_trigger')));
 await db.exec(sql('004_stores.sql'));const afterMigration=(await db.exec(script)).flatMap(r=>r.rows||[]);
 assert.equal(afterMigration.find(r=>r['確認項目']==='public.stores'&&r['区分']==='正確な件数')['結果'],'3');
 assert.equal(afterMigration.find(r=>r['確認項目']==='public.staff_sales_stores'&&r['区分']==='正確な件数')['結果'],'90');
 console.log('PASS: safety review is read-only; exact counts and RLS/admin checks; optional tables absent/present; original rows/schema unchanged; trigger arguments hidden; no production access');
 }finally{await db.close()}})().catch(()=>{console.error('FAIL: local safety review validation failed; no production access or private data logged');process.exit(1)});
