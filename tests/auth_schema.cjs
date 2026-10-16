// PostgreSQL RLS integration test with simulated Supabase Auth claims.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {readFileSync,mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');
const assert=require('node:assert/strict');
const admin='00000000-0000-0000-0000-000000000001',outsider='00000000-0000-0000-0000-000000000002';
(async()=>{const directory=mkdtempSync(join(tmpdir(),'karte-postgres-'));let db=new PGlite(directory);try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 INSERT INTO auth.users VALUES ('${admin}','admin@example.test'),('${outsider}','outsider@example.test');`);
 const migration=readFileSync(join(__dirname,'../supabase/install.sql'),'utf8');await db.exec(migration);await db.exec(migration);
 await db.exec(readFileSync(join(__dirname,'../supabase/003_add_admin.sql'),'utf8').replace('REPLACE_WITH_ADMIN_EMAIL','admin@example.test'));
 await db.exec('SET ROLE anon');let denied=false;try{await db.query('SELECT * FROM public.staff')}catch{denied=true}assert.equal(denied,true);await db.exec('RESET ROLE');
 await db.exec(`SET ROLE authenticated;SET request.jwt.claim.sub='${outsider}'`);
 assert.equal((await db.query('SELECT * FROM public.staff')).rows.length,0);
 denied=false;try{await db.exec("INSERT INTO public.staff(data) VALUES ('{}')")}catch{denied=true}assert.equal(denied,true);
 denied=false;try{await db.exec(`INSERT INTO public.karte_admins(user_id) VALUES ('${outsider}')`)}catch{denied=true}assert.equal(denied,true);
 await db.exec(`SET request.jwt.claim.sub='${admin}'`);assert.equal((await db.query('SELECT * FROM public.staff')).rows.length,15);
 await db.exec("UPDATE public.staff SET data=jsonb_set(data,'{vision}','\"永続保存確認\"'),version=2 WHERE id=1 AND version=1");
 assert.equal((await db.query("SELECT data->>'vision' AS value FROM public.staff WHERE id=1")).rows[0].value,'永続保存確認');
 await db.exec("INSERT INTO public.staff(data) VALUES ('{\"name\":\"架空スタッフ\"}')");await db.exec("DELETE FROM public.staff WHERE data->>'name'='架空スタッフ'");
 await db.exec('RESET ROLE');await db.close();db=new PGlite(directory);
 assert.equal((await db.query("SELECT data->>'vision' AS value FROM public.staff WHERE id=1")).rows[0].value,'永続保存確認');
 await db.exec(`UPDATE public.karte_admins SET active=false WHERE user_id='${admin}';SET ROLE authenticated;SET request.jwt.claim.sub='${admin}'`);
 assert.equal((await db.query('SELECT * FROM public.staff')).rows.length,0);
 console.log('PASS: admin CRUD, anon denied, non-admin denied, self-escalation denied, persisted after PostgreSQL restart, admin revocation, repeatable migrations');
 }finally{await db.close();rmSync(directory,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exit(1)});
