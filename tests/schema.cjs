// Optional PostgreSQL schema test: npm install @electric-sql/pglite outside the checkout.
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
 const sql=readFileSync(join(__dirname,'../supabase/setup.sql'),'utf8');await db.exec(sql);
 let result=await db.query('SELECT id,data,version FROM public.staff ORDER BY id');assert.equal(result.rows.length,15);assert.equal(result.rows[0].data.sales.length,6);assert.equal(result.rows[0].data.skills.length,2);assert.equal(result.rows[0].version,1);
 await db.exec("UPDATE public.staff SET data=jsonb_set(data,'{vision}','\"保存確認\"') WHERE id=1");await db.exec(sql);
 result=await db.query("SELECT data->>'vision' AS vision FROM public.staff WHERE id=1");assert.equal(result.rows[0].vision,'保存確認');
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);let denied=false;try{await db.query('SELECT * FROM public.staff')}catch{denied=true}assert.equal(denied,true);denied=false;try{await db.exec("INSERT INTO public.staff(data) VALUES ('{}')")}catch{denied=true}assert.equal(denied,true);await db.exec('RESET ROLE');
 }
 await db.exec('SET ROLE service_role');assert.equal((await db.query('SELECT count(*)::int AS count FROM public.staff')).rows[0].count,15);await db.exec('RESET ROLE');
 await db.exec('DELETE FROM public.staff');await db.exec(sql);assert.equal((await db.query('SELECT count(*)::int AS count FROM public.staff')).rows[0].count,0);
 console.log('PASS: PostgreSQL schema, 15 fictional samples, 6 sales months, evaluation history, repeatability, no overwrite, no reseed after deletion, anon/authenticated denied, service_role access');
 }finally{await db.close()}})().catch(e=>{console.error(e);process.exit(1)});
