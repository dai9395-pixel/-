// Supabase tokens stay in memory, never in localStorage, URLs or logs.
let enabled=false, session=null, refreshInFlight=null, loginInFlight=null;
async function authRequest(action,data={},token=null){
 const response=await fetch('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'ログインできませんでした。');return result;
}
export async function initializeAuth(){
 const response=await fetch('/runtime.json',{cache:'no-store'});
 if(!response.ok)throw Error('画面の設定を読み込めませんでした。');
 enabled=(await response.json()).authentication===true;
 if(enabled){
  const button=document.createElement('button');button.textContent='ログアウト';button.className='subtle';button.onclick=async()=>{button.disabled=true;try{if(session)await authRequest('logout',{},session.access_token)}catch{}finally{session=null;location.reload()}};document.querySelector('.header-right').append(button);
 }
}
function login(){
 if(loginInFlight)return loginInFlight;
 loginInFlight=new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='login-dialog';
  dialog.innerHTML='<form><div class="eyebrow">STAFF GROWTH KARTE</div><h2>管理者ログイン</h2><p class="hint">登録済みの管理者アカウントでログインしてください。</p><label class="field">メールアドレス<input name="email" type="email" autocomplete="username" required></label><label class="field">パスワード<input name="password" type="password" autocomplete="current-password" required></label><p class="login-error" role="alert"></p><button class="primary" type="submit">ログイン</button></form>';
  dialog.addEventListener('cancel',e=>e.preventDefault());
  dialog.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const button=dialog.querySelector('button');button.disabled=true;dialog.querySelector('.login-error').textContent='';
   try{session=await authRequest('login',Object.fromEntries(new FormData(e.target)));e.target.reset();dialog.close();dialog.remove();resolve()}
   catch(error){dialog.querySelector('.login-error').textContent=error.message}
   finally{button.disabled=false}
  };
  document.body.append(dialog);dialog.showModal();dialog.querySelector('input').focus();
 }).finally(()=>{loginInFlight=null});return loginInFlight;
}
export async function authorizedFetch(path,options){
 if(!enabled)return fetch(path,options);
 if(!session)await login();
 const send=()=>fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+session.access_token}});
 let response=await send();
 if(response.status===401){
  try{
   if(!refreshInFlight)refreshInFlight=authRequest('refresh',{refresh_token:session.refresh_token}).finally(()=>{refreshInFlight=null});
   session=await refreshInFlight;
  }catch{session=null;await login()}
  response=await send();
 }
 return response;
}
