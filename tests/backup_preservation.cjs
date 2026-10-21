// Never connects to Supabase. Imported SQL is parsed as data, never executed.
// STAFF_BACKUP_SQL=/private/path/staff_rows.sql PGLITE_MODULE=/path/to/pglite node tests/backup_preservation.cjs
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const {readFileSync}=require('node:fs');const {join}=require('node:path');const assert=require('node:assert/strict');
function parseBackup(text){
 const header=/^\s*INSERT\s+INTO\s+(?:"?public"?\.)?"?staff"?\s*\(([^)]+)\)\s*VALUES\s*/i.exec(text);
 if(!header)throw Error('Unsupported backup format; only a staff INSERT export is accepted');
 const columns=header[1].split(',').map(s=>s.trim().replace(/^"|"$/g,''));
 assert.deepEqual([...columns].sort(),['data','id','version']);
 let i=header[0].length;const rows=[];const whitespace=()=>{while(/\s/.test(text[i]||'x'))i++};
 while(i<text.length){
  whitespace();assert.equal(text[i++],'(');const values=[];
  while(true){
   whitespace();let value='';
   if(text[i]==="'"){
    i++;let ended=false;
    while(i<text.length){if(text[i]==="'"){if(text[i+1]==="'"){value+="'";i+=2;continue}i++;ended=true;break}value+=text[i++]}
    assert.ok(ended,'Incomplete SQL string');
   }else{while(i<text.length&&!/[,)\s]/.test(text[i]))value+=text[i++]}
   whitespace();values.push(value);const delimiter=text[i++];
   if(delimiter===')')break;assert.equal(delimiter,',');
  }
  assert.equal(values.length,columns.length);const raw=Object.fromEntries(columns.map((key,n)=>[key,values[n]]));
  assert.match(raw.id,/^[1-9]\d*$/);assert.match(raw.version,/^[1-9]\d*$/);
  const data=JSON.parse(raw.data);assert.ok(data&&typeof data==='object'&&!Array.isArray(data));
  rows.push({id:Number(raw.id),version:Number(raw.version),data,jsonText:raw.data});whitespace();
  if(text[i]===','){i++;continue}
  if(text[i]===';')i++;assert.equal(text.slice(i).trim(),'','Extra SQL is not accepted');break;
 }
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);return rows;
}
const same=(a,b,message)=>assert.ok(JSON.stringify(a)===JSON.stringify(b),message);
async function prepare(rows){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE public.staff(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),version integer NOT NULL DEFAULT 1 CHECK(version>0));
 CREATE TABLE public.karte_metadata(key text PRIMARY KEY);INSERT INTO public.karte_metadata VALUES ('sample-v1');`);
 for(const row of rows)await db.query('INSERT INTO public.staff(id,data,version) OVERRIDING SYSTEM VALUE VALUES ($1,$2::jsonb,$3)',[row.id,row.jsonText??JSON.stringify(row.data),row.version]);
 await db.exec(readFileSync(join(__dirname,'../supabase/install.sql'),'utf8'));return db;
}
async function records(db){return (await db.query('SELECT id,data,version FROM public.staff ORDER BY id')).rows}
(async()=>{
 assert.ok(process.env.STAFF_BACKUP_SQL,'Set STAFF_BACKUP_SQL to a privately stored staff_rows.sql');
 const rows=parseBackup(readFileSync(process.env.STAFF_BACKUP_SQL,'utf8'));assert.equal(rows.length,15,'Expected all 15 staff records');
 const migration=readFileSync(join(__dirname,'../supabase/004_stores.sql'),'utf8');
 let db=await prepare(rows);
 try{
  const before=await records(db);await db.exec(migration);same(await records(db),before,'Original staff records changed');
  await db.exec(migration);same(await records(db),before,'Repeated migration changed staff records');
  assert.equal((await db.query("SELECT to_regclass('pg_temp.karte_stores_original_staff') AS name")).rows[0].name,null,'Temporary snapshot must be removed after commit');
  console.log('PASS: uploaded backup of 15 staff imported as parameters; all original JSON and versions unchanged after initial and repeated migration');
  for(const key of ['sales','skills','interviews'])console.log(`Preserved ${key} entries:`,rows.reduce((sum,row)=>sum+row.data[key].length,0));
 }finally{await db.close()}
 db=await prepare(rows);
 try{
  const before=await records(db);
  // Simulate an existing trigger silently altering records during store_id backfill.
  await db.exec(`CREATE FUNCTION public.test_existing_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.data=jsonb_set(NEW.data,'{sales}','[]'::jsonb);NEW.version=OLD.version+1;RETURN NEW;END $$;
  CREATE TRIGGER test_existing_trigger BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.test_existing_trigger();`);
  let rejected=false;try{await db.exec(migration)}catch(error){rejected=true;assert.ok(String(error.message).includes('元のスタッフ記録との差異'))}
  assert.ok(rejected,'Migration must reject a trigger that changes financial records');await db.exec('ROLLBACK');
  same(await records(db),before,'Rollback did not restore original data');
  assert.equal((await db.query("SELECT to_regclass('public.stores') AS name")).rows[0].name,null,'New tables should also be rolled back');
  console.log('PASS: existing-trigger corruption detected; rollback retained all 15 complete original records and versions');
 }finally{await db.close()}
 db=await prepare(rows);
 try{
  const before=await records(db);
  await db.exec(`ALTER TABLE public.staff ADD COLUMN store_id bigint;
  CREATE TABLE public.test_review_queue(staff_id bigint);
  CREATE FUNCTION public.test_review_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN INSERT INTO public.test_review_queue VALUES(NEW.id);END IF;RETURN NEW;END $$;
  CREATE TRIGGER test_review_enqueue AFTER UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.test_review_enqueue();
  CREATE FUNCTION public.test_review_late_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.staff SET data=jsonb_set(data,'{sales}','[]'::jsonb) WHERE id=NEW.staff_id;RETURN NEW;END $$;
  CREATE CONSTRAINT TRIGGER test_review_late_write AFTER INSERT ON public.test_review_queue DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.test_review_late_write();`);
  let rejected=false;try{await db.exec(migration)}catch(error){rejected=true;assert.ok(String(error.message).includes('元のスタッフ記録との差異'))}
  assert.ok(rejected,'Deferred writes must run before final preservation check');await db.exec('ROLLBACK');
  same(await records(db),before,'Deferred write rollback did not preserve original records');
  assert.equal((await db.query("SELECT to_regclass('public.stores') AS name")).rows[0].name,null);
  console.log('PASS: deferred cross-table writes flushed before verification; all original records preserved by rollback');
 }finally{await db.close()}
 db=await prepare(rows);
 try{
  const before=await records(db);
  await db.exec(`CREATE FUNCTION public.test_wrong_affiliation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT max(id) INTO NEW.store_id FROM public.stores;RETURN NEW;END $$;
  CREATE TRIGGER test_wrong_affiliation BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.test_wrong_affiliation();`);
  let rejected=false;try{await db.exec(migration)}catch(error){rejected=true;assert.ok(String(error.message).includes('店舗IDの想定外の変更'))}
  assert.ok(rejected,'Incorrect affiliation backfill must be detected');await db.exec('ROLLBACK');
  same(await records(db),before,'Affiliation rollback changed original records');
  console.log('PASS: unexpected store-ID reassignment detected and rolled back');
 }finally{await db.close()}
 for(const kind of ['invalid-array','invalid-month','duplicate-month']){
  const invalid=structuredClone(rows);
  delete invalid[0].jsonText;
  if(kind==='invalid-array')invalid[0].data.sales={unexpected:true};
  if(kind==='invalid-month')invalid[0].data.sales[0].month='invalid-month';
  if(kind==='duplicate-month')invalid[0].data.sales.push(structuredClone(invalid[0].data.sales[0]));
  db=await prepare(invalid);
  try{
   const before=await records(db);let rejected=false;
   try{await db.exec(migration)}catch{rejected=true}
   assert.ok(rejected,'Invalid existing financial data must stop migration');await db.exec('ROLLBACK');
   same(await records(db),before,'Invalid financial data was changed instead of preserved');
   assert.equal((await db.query("SELECT to_regclass('public.stores') AS name")).rows[0].name,null);
  }finally{await db.close()}
 }
 console.log('PASS: invalid financial arrays, invalid months, and duplicate months stop safely without altering original records');
 db=await prepare(rows);
 try{
  const before=await records(db);
  await db.exec(`CREATE TABLE public.test_unrelated_stores(id bigint PRIMARY KEY);
  INSERT INTO public.test_unrelated_stores SELECT generate_series(1,1000);
  ALTER TABLE public.staff ADD COLUMN store_id bigint;
  ALTER TABLE public.staff ADD CONSTRAINT staff_store_id_fkey FOREIGN KEY(store_id) REFERENCES public.test_unrelated_stores(id) ON DELETE RESTRICT;`);
  let rejected=false;try{await db.exec(migration)}catch(error){rejected=true;assert.ok(String(error.message).includes('店舗IDの外部キー'))}
  assert.ok(rejected,'An existing foreign key with the wrong target must stop migration');await db.exec('ROLLBACK');
  same(await records(db),before,'Foreign-key conflict changed original records');
  console.log('PASS: unexpected existing store-ID foreign key rejected without modifying staff');
 }finally{await db.close()}
 db=await prepare(rows);
 try{
  const before=await records(db);
  await db.exec('CREATE TABLE public.test_index_collision(id bigint);CREATE UNIQUE INDEX stores_name_unique ON public.test_index_collision(id)');
  let rejected=false;try{await db.exec(migration)}catch(error){rejected=true;assert.ok(String(error.message).includes('店舗名の重複防止索引'))}
  assert.ok(rejected,'A conflicting index name must not bypass duplicate protection');await db.exec('ROLLBACK');
  same(await records(db),before,'Index collision changed staff records');
  console.log('PASS: unexpected existing index definition rejected without modifying staff');
 }finally{await db.close()}
 db=await prepare(rows);
 try{
  await db.exec(migration);
  const first=rows[0].id;
  const destination=(await db.query("INSERT INTO public.stores(name) VALUES ('検証専用の異動先') RETURNING id")).rows[0].id;
  await db.query('UPDATE public.staff SET store_id=$1 WHERE id=$2',[destination,first]);
  const before=await records(db),links=(await db.query('SELECT * FROM public.staff_sales_stores ORDER BY staff_id,month')).rows;
  await db.exec(`CREATE FUNCTION public.test_replace_sales_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM public.staff_sales_stores WHERE staff_id=NEW.staff_id AND month=NEW.month;RETURN NEW;END $$;
  CREATE TRIGGER test_replace_sales_link BEFORE INSERT ON public.staff_sales_stores FOR EACH ROW EXECUTE FUNCTION public.test_replace_sales_link();`);
  let rejected=false;try{await db.exec(migration)}catch(error){rejected=true;assert.ok(String(error.message).includes('既存の売上集計先の変更'))}
  assert.ok(rejected,'Repeated migration must preserve existing historical sale attribution');await db.exec('ROLLBACK');
  same(await records(db),before,'Historical link protection changed staff records');
  same((await db.query('SELECT * FROM public.staff_sales_stores ORDER BY staff_id,month')).rows,links,'Rollback failed to preserve historical links');
  console.log('PASS: historical sale attribution changes detected and rolled back');
 }finally{await db.close()}
})().catch(()=>{console.error('FAIL: backup preservation check failed; no backup data is logged and no production database was accessed');process.exit(1)});
