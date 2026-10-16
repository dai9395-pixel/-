// Shared-password access for the single-administrator sample deployment.
let enabled=false;
let password=''; // memory only: closing/reloading the page requires signing in again.
export async function initializeAuth(){
 const response=await fetch('/runtime.json',{cache:'no-store'});
 if(!response.ok)throw Error('画面の設定を読み込めませんでした。');
 enabled=(await response.json()).authentication===true;
 if(enabled){
  const button=document.createElement('button');button.textContent='ログアウト';button.className='subtle';button.onclick=()=>{password='';location.reload()};document.querySelector('.header-right').append(button);
 }
}
function login(message=''){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='login-dialog';
  dialog.innerHTML='<form><div class="eyebrow">STAFF GROWTH KARTE</div><h2>管理者ログイン</h2><p class="hint">サンプルデータを開くには、設定した管理者パスワードを入力してください。</p><label class="field">管理者パスワード<input name="password" type="password" autocomplete="current-password" required minlength="16"></label><p class="login-error" role="alert"></p><button class="primary" type="submit">ログイン</button></form>';
  dialog.querySelector('.login-error').textContent=message;
  dialog.addEventListener('cancel',e=>e.preventDefault());
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();password=new FormData(e.target).get('password');dialog.close();dialog.remove();resolve()};
  document.body.append(dialog);dialog.showModal();dialog.querySelector('input').focus();
 });
}
export async function authorizedFetch(path,options){
 if(!enabled)return fetch(path,options);
 if(!password)await login();
 let response=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+password}});
 while(response.status===401){password='';await login('パスワードが違います。もう一度入力してください。');response=await fetch(path,{...options,headers:{...options.headers,Authorization:'Bearer '+password}})}
 return response;
}
