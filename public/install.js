// Installation is optional and never changes authentication or stored records.
const button=document.querySelector('#install-app');
const help=document.querySelector('#install-help');
const standalone=window.matchMedia('(display-mode: standalone)');
let pendingPrompt=null;
function update(){button.hidden=standalone.matches||window.navigator.standalone===true;}
update();
standalone.addEventListener('change',update);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pendingPrompt=event;});
window.addEventListener('appinstalled',()=>{pendingPrompt=null;button.hidden=true;if(help.open)help.close();});
button.addEventListener('click',async()=>{
 if(pendingPrompt){const prompt=pendingPrompt;pendingPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch{help.showModal();}}
 else help.showModal();
});
for(const id of ['install-close','install-done'])document.getElementById(id).onclick=()=>help.close();
