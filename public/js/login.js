(async()=>{
  const form=document.querySelector('#loginForm'),msg=document.querySelector('#loginMsg'),music=document.querySelector('#loginMusic'),toggle=document.querySelector('#musicToggle');
  try{const r=await fetch('/api/public/settings'),s=await r.json();if(s.logo_url){document.querySelector('#loginLogoLarge').src=s.logo_url;}document.querySelector('#loginSiteNameLarge').textContent=s.site_name||'DC RECARGAS';if(s.login_cover_url){const show=document.querySelector('#loginShowcase');show.style.backgroundImage=`linear-gradient(to top,rgba(7,8,11,.90),rgba(7,8,11,.34)),url("${String(s.login_cover_url).replace(/"/g,'')}")`;show.style.backgroundSize='cover';show.style.backgroundPosition='center';}
    if(s.login_music_url){music.src=s.login_music_url;music.volume=.28;try{await music.play();}catch{toggle.style.display='block';toggle.onclick=async()=>{try{await music.play();toggle.style.display='none';}catch{}}}}
  }catch{}
  try{const me=await fetch('/api/auth/me');if(me.ok){location.href='/admin.html';return;}}catch{}
  form.onsubmit=async e=>{e.preventDefault();msg.textContent='Ingresando…';const data=Object.fromEntries(new FormData(form));try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),j=await r.json();if(!r.ok)throw new Error(j.error||'No se pudo iniciar sesión');location.href='/admin.html';}catch(err){msg.textContent=err.message;}};
})();
