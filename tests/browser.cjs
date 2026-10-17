// Optional browser smoke test: requires Playwright and system Chromium.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const dir=mkdtempSync(join(tmpdir(),'karte-browser-'));
 const server=spawn('python',['server.py','--port','18082'],{cwd:join(__dirname,'..'),env:{...process.env,KARTE_DB:join(dir,'test.sqlite3')},stdio:'ignore'});
 let browser;
 try{
  for(let n=0;n<100;n++){try{await fetch('http://127.0.0.1:18082/api/staff');break}catch{await new Promise(r=>setTimeout(r,50))}}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1194,height:834},locale:'ja-JP'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:18082');await page.waitForSelector('.staff-row');assert.equal(await page.locator('.staff-row').count(),15);
  await page.click('#add-staff');await page.fill('[name=name]','検証用 スタッフ');await page.selectOption('[name=store_id]',{label:'表参道店'});await page.fill('[name=role]','アシスタント');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);
  assert.match(await page.locator('.profile').innerText(),/検証用 スタッフ/);
  await page.click('[data-edit=sales]');await page.fill('[name=target]','1000000');await page.fill('[name=actual]','1200000');await page.fill('[name=nominated]','800000');await page.fill('[name=customers]','100');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);
  assert.match(await page.locator('.sales-metrics').innerText(),/120%/);assert.match(await page.locator('.customer-stats').innerText(),/12,000/);
  await page.click('[data-edit=goals]');await page.fill('[name=vision]','信頼される美容師へ');await page.fill('[name=progress]','80');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.match(await page.locator('.goal-card').innerText(),/信頼される美容師へ/);
  await page.click('[data-edit=skills]');await page.selectOption('[name=skill0]','5');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.match(await page.locator('.skill-row').first().innerText(),/5/);
  await page.click('[data-edit=interview]');await page.fill('[name=worry]','サンプルの悩み');await page.fill('[name=next]','提案の練習');await page.click('#save-button');await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.match(await page.locator('.interview-card').innerText(),/提案の練習/);
  await page.reload();await page.waitForSelector('.staff-row');await page.getByRole('button',{name:/検証用 スタッフ/}).click();assert.match(await page.locator('.goal-card').innerText(),/信頼される美容師へ/);assert.match(await page.locator('.interview-card').innerText(),/サンプルの悩み/);
  for(const width of [1194,834,768,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`)}
  page.once('dialog',d=>d.accept());await page.click('#delete-staff');await page.waitForFunction(()=>document.querySelectorAll('.staff-row').length===15);
  await page.fill('#search','橘');assert.equal(await page.locator('.staff-row').count(),1);await page.fill('#search','');await page.selectOption('#store-filter',{label:'代官山店'});assert.equal(await page.locator('.staff-row').count(),5);
  const authPage=await browser.newPage({viewport:{width:834,height:1194}});
  await authPage.route('**/runtime.json',route=>route.fulfill({json:{authentication:true}}));
  let refreshed=false;
  await authPage.route('**/api/auth/login',route=>{const data=route.request().postDataJSON();return data.email==='admin@example.test'&&data.password==='browser-test-password-only'?route.fulfill({json:{access_token:'expired-token',refresh_token:'test-refresh-token',expires_in:3600}}):route.fulfill({status:401,json:{error:'メールアドレスまたはパスワードが違います'}})});
  await authPage.route('**/api/auth/refresh',route=>{refreshed=true;return route.fulfill({json:{access_token:'browser-test-access-token',refresh_token:'new-refresh-token',expires_in:3600}})});
  await authPage.route(/\/api\/(staff|stores)(\/|$|\?)/,route=>route.request().headers().authorization==='Bearer browser-test-access-token'?route.continue():route.fulfill({status:401,json:{error:'ログインが必要です'}}));
  await authPage.goto('http://127.0.0.1:18082');await authPage.waitForSelector('.login-dialog');
  await authPage.fill('[name=email]','admin@example.test');await authPage.fill('[name=password]','incorrect-password');await authPage.click('.login-dialog button');await authPage.waitForFunction(()=>document.querySelector('.login-error')?.textContent.includes('違います'));
  await authPage.fill('[name=password]','browser-test-password-only');await authPage.click('.login-dialog button');await authPage.waitForSelector('.staff-row');
  assert.equal(await authPage.locator('.staff-row').count(),15);assert.equal(refreshed,true);
  await authPage.reload();await authPage.waitForSelector('.login-dialog');
  assert.equal(await authPage.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('browser-test-')),false);
  await authPage.close();
  assert.deepEqual(errors,[]);console.log('PASS: staff CRUD, sales calculations, goals, skills, interviews, reload persistence, search/filter, 4 viewport widths, no JavaScript errors, cloud login gating and invalid-password retry');
 }finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.once('exit',r));rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
