// Access tokens stay in memory. Optional persistent refresh uses a Secure HttpOnly cookie.
let enabled=false, session=null, refreshInFlight=null, loginInFlight=null, expiresAt=0;
async function authRequest(action,data={},token=null){
 const response=await fetch('/api/auth/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
 const result=await response.json();if(!response.ok){const error=Error(result.error||'ログインできませんでした。');error.status=response.status;throw error;}return result;
}
function acceptSession(value){session=value;expiresAt=Date.now()+Number(value.expires_in||3600)*1000;}
async function refreshSession(){
 if(!refreshInFlight){
  const run=async()=>{acceptSession(await authRequest('refresh',session?.refresh_token?{refresh_token:session.refresh_token}:{}));};
  refreshInFlight=(navigator.locks?navigator.locks.request('karte-session-refresh',run):run()).finally(()=>{refreshInFlight=null});
 }
 return refreshInFlight;
}
export async function initializeAuth(){
 const response=await fetch('/runtime.json',{cache:'no-store'});
 if(!response.ok)throw Error('画面の設定を読み込めませんでした。');
 enabled=(await response.json()).authentication===true;
 if(enabled){
  try{await refreshSession()}catch(error){if(![400,401,403].includes(error.status))throw error;}
  const button=document.createElement('button');button.textContent='ログアウト';button.className='subtle';button.onclick=async()=>{button.disabled=true;try{await authRequest('logout',{},session?.access_token)}catch{button.disabled=false;alert('ログアウトできませんでした。通信を確認してもう一度お試しください。');return}session=null;location.reload()};document.querySelector('.header-right').append(button);
 }
}
function login(){
 if(loginInFlight)return loginInFlight;
 loginInFlight=new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='login-dialog';
  dialog.innerHTML='<form><div class="eyebrow">STAFF GROWTH KARTE</div><h2>管理者ログイン</h2><p class="hint">登録済みの管理者アカウントでログインしてください。</p><label class="field">メールアドレス<input name="email" type="email" autocomplete="username" required></label><label class="field">パスワード<input name="password" type="password" autocomplete="current-password" required></label><label class="remember-login"><input name="remember" type="checkbox" checked> この端末でログインを保持する</label><p class="hint">ご自身の端末で利用してください。共有端末ではチェックを外してください。</p><p class="login-error" role="alert"></p><button class="primary" type="submit">ログイン</button></form>';
  dialog.addEventListener('cancel',e=>e.preventDefault());
  dialog.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const button=dialog.querySelector('button');button.disabled=true;dialog.querySelector('.login-error').textContent='';
   try{const values=Object.fromEntries(new FormData(e.target));values.remember=values.remember==='on';acceptSession(await authRequest('login',values));e.target.reset();dialog.close();dialog.remove();resolve()}
   catch(error){dialog.querySelector('.login-error').textContent=error.message}
   finally{button.disabled=false}
  };
  document.body.append(dialog);dialog.showModal();dialog.querySelector('input').focus();
 }).finally(()=>{loginInFlight=null});return loginInFlight;
}
export async function authorizedFetch(path,options={}){
 if(!enabled)return fetch(path,options);
 if(!session)await login();
 if(Date.now()>=expiresAt-60000){
  try{await refreshSession()}catch(error){if(![400,401,403].includes(error.status))throw error;session=null;await login();}
 }
 const send=()=>fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+session.access_token}});
 let response=await send();
 if(response.status===401){
  try{await refreshSession()}catch(error){if(![400,401,403].includes(error.status))throw error;session=null;await login();}
  response=await send();
 }
 return response;
}
