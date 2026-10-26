const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'karte-actions-'));
 const server=spawn('python',['server.py','--port','18083'],{cwd:join(__dirname,'..'),env:{...process.env,KARTE_DB:join(dir,'test.sqlite3')},stdio:'ignore'});let browser;
 try{
 for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:18083/api/staff');break}catch{await new Promise(r=>setTimeout(r,50))}}
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1194,height:834}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:18083');await page.waitForSelector('.action-item');
 assert.equal(await page.locator('.action-item').count(),15);
 const before=await (await fetch('http://127.0.0.1:18083/api/staff')).json();
 await page.locator('.action-item button').first().click();await page.fill('[name=next]','週1回、提案の練習');await page.fill('[name=due]','2020-01-01');await page.selectOption('[name=status]','doing');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);
 await page.selectOption('#action-filter','late');assert.equal(await page.locator('.action-item').count(),1);assert.match(await page.locator('.action-item').innerText(),/期限超過/);
 await page.reload();await page.waitForSelector('.action-item');await page.selectOption('#action-filter','late');assert.match(await page.locator('.action-item').innerText(),/週1回、提案の練習/);
 await page.locator('.action-item button').click();await page.selectOption('[name=status]','done');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.equal(await page.locator('.action-item').count(),0);
 await page.selectOption('#action-filter','done');assert.equal(await page.locator('.action-item').count(),1);
 const after=await (await fetch('http://127.0.0.1:18083/api/staff')).json();for(const k of ['sales','skills','store_id','sales_stores'])assert.deepEqual(after[0][k],before[0][k]);assert.deepEqual(after.slice(1),before.slice(1));
 await page.fill('#search','存在しないスタッフ');assert.equal(await page.locator('.action-item').count(),0);await page.fill('#search','');
 for(const width of [1194,834,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.deepEqual(errors,[]);console.log('PASS: legacy records, deadline overdue, completion filters, search, persistence, unrelated records preserved, responsive widths');
 }finally{await browser?.close();server.kill();rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
