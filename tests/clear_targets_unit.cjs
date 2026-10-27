const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const code=fs.readFileSync('public/app.js','utf8');
(async()=>{
 const records=[{id:1,version:1,store_id:2,sales_stores:{'2026-10':1},sales:[{month:'2026-10',target:500,actual:90,customers:2},{month:'2026-11',target:600}],reset_backup:{before:{annual:'old'}},interviews:[{next:'keep'}]},{id:2,version:1,store_id:2,sales:[{month:'2026-10',target:700,actual:80}]}];
 const els={},ctx=vm.createContext({structuredClone,console,staff:structuredClone(records),render(){},toast(){},$:id=>els[id]??=( {disabled:false,textContent:'',close(){}} )});
 let db=structuredClone(records),writes=0;
 ctx.api=async(path,method,data)=>{if(!method)return structuredClone(db);writes++;const saved={...data,version:data.version+1};db=db.map(s=>s.id===saved.id?saved:s);return saved};
 vm.runInContext(code.slice(code.indexOf('let targetClearPlan='),code.indexOf("$('#editor').addEventListener('cancel'")),ctx);
 vm.runInContext("targetClearPlan={storeId:'1',month:'2026-10',versions:[[1,1]]}",ctx);await vm.runInContext('saveTargetClear()',ctx);
 assert.equal(writes,1);const expected=structuredClone(records[0]);expected.version++;expected.sales[0].target=0;assert.deepEqual(structuredClone(db[0]),expected);assert.deepEqual(db[1],records[1]);
 vm.runInContext("targetClearPlan={storeId:'all',month:'2026-10',versions:[[2,1]]}",ctx);db[1].version=2;await vm.runInContext('saveTargetClear()',ctx);assert.equal(writes,1);assert.match(els['#form-error'].textContent,/更新されています/);
 vm.runInContext("targetClearPlan={storeId:'all',month:'2026-10',versions:[[2,2]]}",ctx);await vm.runInContext('saveTargetClear()',ctx);assert.equal(db[1].sales[0].target,0);assert.equal(writes,2);
 console.log('PASS: historical store attribution, selected month, other values and backup preserved, concurrent update blocked, all-store clear');
})().catch(e=>{console.error(e);process.exit(1)});
