const $=s=>document.querySelector(s);
function tab(mode){document.querySelectorAll('.auth-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('#signup-form').classList.toggle('hidden',mode!=='signup');$('#login-form').classList.toggle('hidden',mode!=='login')}
document.querySelectorAll('.auth-tabs button').forEach(b=>b.onclick=()=>tab(b.dataset.mode));
function msg(text,ok=false){const x=$('#auth-msg');x.textContent=text;x.style.color=ok?'#087b4b':'#b63333'}
async function boot(){
  if(!RecoverCloud.isConfigured()){$('#cloud-warning').style.display='block';$('#auth-area').style.display='none';return}
  try{const s=await RecoverCloud.getSession();if(s)location.href='app.html'}catch(e){msg('Configuration cloud invalide : '+e.message)}
}
$('#signup-form').onsubmit=async e=>{e.preventDefault();let email=$('#su-email').value.trim().toLowerCase(),name=$('#su-name').value.trim(),pass=$('#su-pass').value;if(!email||pass.length<8)return msg('Mot de passe : au moins 8 caractères.');try{msg('Création du compte…',true);const d=await RecoverCloud.signUp(name,email,pass);if(d.session){location.href='app.html'}else{msg('Compte créé ✅ Vérifiez votre e-mail pour confirmer le compte, puis revenez vous connecter.',true)}}catch(err){msg(err.message||'Impossible de créer le compte.')}};
$('#login-form').onsubmit=async e=>{e.preventDefault();let email=$('#li-email').value.trim().toLowerCase(),pass=$('#li-pass').value;try{msg('Connexion…',true);await RecoverCloud.signIn(email,pass);location.href='app.html'}catch(err){msg(err.message||'E-mail ou mot de passe incorrect.')}};
boot();
