const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'karte-targets-')),base='http://127.0.0.1:18089';
 const server=spawn('python',['server.py','--port','18089'],{cwd:join(__dirname,'..'),env:{...process.env,KARTE_DB:join(dir,'test.sqlite3')},stdio:'ignore'});let browser;
 try{
  for(let n=0;n<100;n++){try{await fetch(base+'/api/staff');break}catch{await new Promise(r=>setTimeout(r,50))}}
  const get=async()=>await (await fetch(base+'/api/staff')).json();
  let before=await get();const month=before[0].sales.at(-1).month,storeId=before[0].store_id;
  // An existing reset must not block target deletion or lose its backup.
  const seeded={...before[0],reset_backup:{before:{annual:'previous'},after:{annual:before[0].annual},at:'2026-01-01'}};
  assert((await fetch(base+'/api/staff/'+seeded.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(seeded)})).ok);
  before=await get();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:834,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('.staff-row');await page.locator('[data-view=stores]:visible').click();await page.fill('#stores-month',month);await page.dispatchEvent('#stores-month','change');
  await page.click(`[data-clear-targets="${storeId}"]`);await page.click('#cancel-modal');assert.deepEqual(await get(),before);
  await page.click(`[data-clear-targets="${storeId}"]`);await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);
  const after=await get();
  for(const old of before){const now=after.find(s=>s.id===old.id);const expected=structuredClone(old);if((old.sales_stores?.[month]??old.store_id)===storeId){expected.sales=expected.sales.map(r=>r.month===month?{...r,target:0}:r);delete expected.version;const actual=structuredClone(now);delete actual.version;assert.deepEqual(actual,expected)}else assert.deepEqual(now,old)}
  await page.reload();await page.waitForSelector('.staff-row');await page.locator('[data-view=stores]:visible').click();await page.fill('#stores-month',month);await page.dispatchEvent('#stores-month','change');assert(await page.locator(`[data-clear-targets="${storeId}"]`).isDisabled());
  await page.click('[data-clear-targets=all]');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);
  for(const s of await get())assert.equal(s.sales.find(r=>r.month===month)?.target||0,0);
  for(const width of [834,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
  assert.deepEqual(errors,[]);console.log('PASS: cancel, store and all-store deletion, existing backup preserved, other fields and months preserved, reload persistence, responsive UI');
 }finally{await browser?.close();server.kill();rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
