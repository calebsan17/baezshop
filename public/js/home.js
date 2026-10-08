(async()=>{
  const { $,esc,api,productCard }=window.DC;
  let settings;
  try{settings=await window.DC.loadBase();}catch(e){window.DC.toast(e.message);return;}

  async function renderProducts(){
    try{
      settings=await api('/api/public/settings');
      window.DC.settings=settings; window.DC.applyAppearance(settings);
      const products=await api('/api/public/products');
      const featured=products.filter(p=>p.featured&&p.stock_status!=='out').slice(0,4);
      const grid=$('#featuredGrid');
      grid.innerHTML=(featured.length?featured:products.slice(0,4)).map(p=>productCard(p,settings.pen_per_usd)).join('')||'<div class="empty">Todavía no hay productos visibles.</div>';
      const hero=featured[0]||products.find(p=>p.stock_status!=='out');
      if(hero)$('#heroProduct').innerHTML=`<img src="${esc(hero.image_url)}" alt="${esc(hero.name)}"><div><strong>${esc(hero.name)}</strong><span>${esc(hero.subtitle||window.DC.categoryName(hero.category))}</span><span class="hero-price">S/ ${Number(hero.price_pen).toFixed(2)}</span></div>`;
    }catch(e){$('#featuredGrid').innerHTML=`<div class="empty">${esc(e.message)}</div>`;}
  }

  function channelAction(s,extraClass=''){
    const label=esc(s.button_text||'Visitar canal');
    if(s.url)return `<a class="btn btn-primary ${extraClass}" target="_blank" rel="noopener" href="${esc(s.url)}">${label}</a>`;
    return `<span class="btn btn-outline ${extraClass} disabled-link" aria-disabled="true">Enlace por configurar</span>`;
  }

  function socialCard(s){
    const media=s.image_url?`<img src="${esc(s.image_url)}" alt="${esc(s.name)}">`:'<div class="social-fallback"></div>';
    return `<article class="social-card ${s.is_live?'is-live':''}">${media}${s.is_live?'<span class="live-pill">EN VIVO</span>':''}<div class="social-card-content"><div class="social-platform">${esc(s.platform||'CANAL')}</div><h3>${esc(s.name)}</h3><p>${esc(s.handle||'Canal oficial')}</p>${channelAction(s)}</div></article>`;
  }

  function liveCard(s){
    const media=s.image_url?`<div class="live-now-media"><img src="${esc(s.image_url)}" alt="${esc(s.name)}"></div>`:'<div class="live-now-media live-now-fallback"><span>LIVE</span></div>';
    return `<article class="live-now-card">${media}<div class="live-now-content"><div class="live-status"><span class="live-status-dot"></span> TRANSMISIÓN ACTIVA</div><div class="live-meta">${esc(s.platform||'CANAL OFICIAL')}</div><h3>${esc(s.name)}</h3><p>${esc(s.handle||'El canal está transmitiendo en este momento.')}</p><div class="live-actions">${channelAction(s,'live-watch')}</div></div><div class="live-now-glow"></div></article>`;
  }

  async function renderSocials(){
    const el=$('#socialGrid'),liveEl=$('#liveNow');
    try{
      const rows=await api('/api/public/social-channels');
      const live=rows.filter(s=>s.is_live);
      if(live.length){
        liveEl.classList.remove('hidden');
        liveEl.innerHTML=`<div class="live-now-heading"><span class="live-status-dot"></span><span>Ahora en vivo</span><small>${live.length===1?'1 transmisión activa':`${live.length} transmisiones activas`}</small></div><div class="live-now-grid">${live.map(liveCard).join('')}</div>`;
      }else{
        liveEl.classList.add('hidden');
        liveEl.innerHTML='';
      }
      if(!rows.length){
        el.innerHTML='<div class="social-placeholder">Agrega Instagram, TikTok, YouTube, Twitch, Facebook o WhatsApp desde el panel administrativo.</div>';
        return;
      }
      el.innerHTML=rows.map(socialCard).join('');
    }catch(e){
      liveEl.classList.add('hidden');
      el.innerHTML=`<div class="social-placeholder">${esc(e.message)}</div>`;
    }
  }

  function recommendationCard(r){
    const initial=esc((r.customer_name||'C').trim().charAt(0).toUpperCase());
    const date=r.created_at?new Date(r.created_at).toLocaleDateString('es-PE',{year:'numeric',month:'short'}):'';
    return `<article class="recommendation-card ${r.featured?'featured':''}"><div class="recommendation-top"><div class="recommendation-person"><div class="recommendation-avatar">${initial}</div><div><strong>${esc(r.customer_name)}</strong><small>${date?`Cliente · ${esc(date)}`:'Cliente verificado por moderación'}</small></div></div><span class="recommendation-score">${Number(r.rating)||5} / 5</span></div><blockquote>${esc(r.message)}</blockquote></article>`;
  }
  async function renderRecommendations(){
    const grid=$('#recommendationsGrid');if(!grid)return;
    try{const rows=await api('/api/public/recommendations');grid.innerHTML=rows.length?rows.map(recommendationCard).join(''):'<div class="recommendation-empty">Todavía no hay recomendaciones publicadas. Puedes ser la primera persona en compartir su experiencia.</div>';}
    catch(e){grid.innerHTML=`<div class="recommendation-empty">${esc(e.message)}</div>`;}
  }
  const recForm=$('#recommendationForm'),recMessage=$('#recommendationMessage'),recCount=$('#recommendationCount'),recStatus=$('#recommendationStatus');
  if(recMessage)recMessage.addEventListener('input',()=>{recCount.textContent=`${recMessage.value.length} / 700`;});
  if(recForm)recForm.addEventListener('submit',async e=>{e.preventDefault();recStatus.className='recommendation-status';recStatus.textContent='Enviando recomendación...';const btn=recForm.querySelector('button[type="submit"]');btn.disabled=true;try{const payload=Object.fromEntries(new FormData(recForm));payload.rating=Number(payload.rating);const r=await api('/api/public/recommendations',{method:'POST',body:JSON.stringify(payload)});recForm.reset();if(recCount)recCount.textContent='0 / 700';recStatus.className='recommendation-status success';recStatus.textContent=r.message||'Recomendación enviada correctamente.';}catch(err){recStatus.className='recommendation-status error';recStatus.textContent=err.message;}finally{btn.disabled=false;}});
  await renderRecommendations();

  async function renderFaqs(){
    try{
      const faqs=await api('/api/public/faqs'),el=$('#faqList');
      el.innerHTML=faqs.map(f=>`<article class="faq-item"><button class="faq-q" type="button"><span>${esc(f.question)}</span><span>+</span></button><div class="faq-a">${esc(f.answer)}</div></article>`).join('')||'<div class="empty">No hay preguntas frecuentes configuradas.</div>';
      el.querySelectorAll('.faq-q').forEach(b=>b.onclick=()=>{const item=b.closest('.faq-item');item.classList.toggle('open');b.lastElementChild.textContent=item.classList.contains('open')?'−':'+';});
    }catch{}
  }

  async function refreshHomeRealtime(){
    await Promise.all([renderProducts(),renderSocials(),renderRecommendations(),renderFaqs()]);
  }
  await refreshHomeRealtime();

  let realtimeRefreshTimer=null;
  window.addEventListener('dc:content-updated',()=>{
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer=setTimeout(refreshHomeRealtime,180);
  });

  // Respaldo por si el navegador/proxy corta SSE.
  const secs=Math.max(15,Number(settings.auto_refresh_seconds)||30);
  setInterval(refreshHomeRealtime,secs*1000);
})();
