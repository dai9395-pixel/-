// Shared, deterministic calculations. Sales stay with the month’s recorded store.
export function summarizeStores(staff,stores,month){
 return stores.map(store=>{
  const result={...store,staffCount:0,actual:0,target:0,nominated:0,customers:0,recordedCount:0};
  for(const person of staff){
   if(person.store_id===store.id)result.staffCount++;
   const sale=person.sales.find(s=>s.month===month);
   if(sale&&(person.sales_stores?.[month]??person.store_id)===store.id){
    result.recordedCount++;
    for(const key of ['actual','target','nominated','customers'])result[key]+=Number(sale[key]||0);
   }
  }
  result.achievement=result.target>0?Math.round(result.actual/result.target*100):null;
  return result;
 });
}
