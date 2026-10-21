import assert from 'node:assert/strict';
import {summarizeStores} from '../public/stores.js';
const stores=[{id:1,name:'元店舗',active:false},{id:2,name:'異動先',active:true},{id:3,name:'空店舗',active:true}];
const staff=[{store_id:2,sales_stores:{'2026-09':1,'2026-10':2},sales:[{month:'2026-09',actual:900000,target:1000000,customers:90,nominated:500000},{month:'2026-10',actual:1200000,target:1000000,customers:100,nominated:800000}]},{store_id:1,sales_stores:{'2026-09':1},sales:[{month:'2026-09',actual:300000,target:500000,customers:30,nominated:100000}]}];
const before=structuredClone(staff),september=summarizeStores(staff,stores,'2026-09');
assert.equal(september[0].actual,1200000);assert.equal(september[0].target,1500000);assert.equal(september[0].achievement,80);assert.equal(september[0].customers,120);assert.equal(september[0].staffCount,1);assert.equal(september[1].actual,0);assert.equal(september[1].staffCount,1);assert.equal(september[2].achievement,null);
const october=summarizeStores(staff,stores,'2026-10');assert.equal(october[1].achievement,120);assert.equal(october[1].actual,1200000);assert.equal(october[0].achievement,null);assert.deepEqual(staff,before);
console.log('PASS: store totals, weighted achievement, inactive-store history, transfer attribution, current headcount, zero targets, no mutation');
