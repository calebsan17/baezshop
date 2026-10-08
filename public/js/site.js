(()=>{
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const api=async(url,opts={})=>{const res=await fetch(url,{cache:'no-store',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||'No se pudo completar la solicitud');return data;};
  const money=n=>`S/ ${Number(n||0).toFixed(2)}`;
  const categoryName=c=>({diamonds:'Diamantes',accounts:'Cuentas',extras:'Extras',entertainment:'Entretenimiento'}[c]||c);
  const toast=msg=>{const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),3200);};
  const productCard=(p,rate=3.75)=>{const usd=(Number(p.price_pen)/(Number(rate)||3.75)).toFixed(2);const discount=p.old_price_pen&&Number(p.old_price_pen)>Number(p.price_pen)?Math.max(1,Math.round((1-Number(p.price_pen)/Number(p.old_price_pen))*100)):0;return `<article class="product-card ${p.stock_status==='out'?'stock-out':''}"><div class="product-image-wrap">${discount?`<span class="badge">-${discount}%</span>`:''}<img class="product-image" src="${esc(p.image_url||'/assets/logo.svg')}" alt="${esc(p.name)}"></div><div class="category-label">${esc(categoryName(p.category))}</div><h3>${esc(p.name)}</h3><p class="sub">${esc(p.subtitle||'Producto digital')}</p>${p.old_price_pen?`<div class="old">${money(p.old_price_pen)}</div>`:''}<div class="price-row"><span class="price">${money(p.price_pen)}</span><span class="usd">≈ $ ${usd}</span></div><a class="btn btn-primary" href="/product.html?id=${p.id}">${p.stock_status==='out'?'Sin stock':'Ver detalles'}</a></article>`;};

  const MUSIC_PREF='dc_store_music_v23';
  let musicState={root:null,audio:null,play:null,mute:null,range:null,status:null,url:'',gestureBound:false};
  const readMusicPref=()=>{try{return JSON.parse(localStorage.getItem(MUSIC_PREF)||'{}')}catch{return{}}};
  const writeMusicPref=p=>{try{localStorage.setItem(MUSIC_PREF,JSON.stringify(p))}catch{}};
  const iconPlay='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const iconPause='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  const iconVolume='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9c1 .8 1.5 1.8 1.5 3S17 14.2 16 15"/></svg>';
  const iconMute='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>';

  function removeMusicDock(){
    if(musicState.audio){musicState.audio.pause();musicState.audio.removeAttribute('src');}
    if(musicState.root)musicState.root.remove();
    musicState={root:null,audio:null,play:null,mute:null,range:null,status:null,url:'',gestureBound:false};
  }
  function syncMusicDock(){
    const s=musicState;if(!s.root||!s.audio)return;
    const playing=!s.audio.paused;
    s.play.innerHTML=playing?iconPause:iconPlay;
    s.play.setAttribute('aria-label',playing?'Pausar música':'Reproducir música');
    s.play.title=playing?'Pausar música':'Reproducir música';
    s.mute.innerHTML=s.audio.muted||s.audio.volume===0?iconMute:iconVolume;
    s.mute.setAttribute('aria-label',s.audio.muted?'Activar sonido':'Silenciar');
    s.mute.title=s.audio.muted?'Activar sonido':'Silenciar';
    s.status.textContent=playing?(s.audio.muted?'Reproduciendo · Silenciado':'Reproduciendo'):(s.root.classList.contains('needs-gesture')?'Presiona para activar música':'Música pausada');
    s.root.classList.toggle('is-playing',playing);
  }
  async function tryPlayMusic(fromUser=false){
    const s=musicState;if(!s.audio||!s.audio.src)return false;
    try{await s.audio.play();if(fromUser){const p=readMusicPref();p.userPaused=false;writeMusicPref(p);}s.root?.classList.remove('needs-gesture');syncMusicDock();return true;}catch{s.root?.classList.add('needs-gesture');if(s.status)s.status.textContent='Presiona para activar música';syncMusicDock();return false;}
  }
  function ensureMusicDock(settings){
    const enabled=String(settings.store_music_enabled)==='1'&&Boolean(settings.store_music_url);
    if(!enabled){removeMusicDock();return;}
    if(!musicState.root){
      const root=document.createElement('aside');root.className='music-dock';root.setAttribute('aria-label','Control de música de la tienda');
      root.innerHTML=`<div class="music-dock-info"><span class="music-eq" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>Música de la tienda</strong><small data-music-status>Música pausada</small></div></div><div class="music-dock-controls"><button class="music-icon-btn" type="button" data-music-play aria-label="Reproducir música"></button><button class="music-icon-btn" type="button" data-music-mute aria-label="Silenciar"></button><div class="music-volume"><input type="range" min="0" max="100" step="1" aria-label="Volumen" data-music-volume><span data-music-volume-label>35%</span></div></div><audio preload="metadata" data-music-audio></audio>`;
      document.body.appendChild(root);
      musicState.root=root;musicState.audio=$('[data-music-audio]',root);musicState.play=$('[data-music-play]',root);musicState.mute=$('[data-music-mute]',root);musicState.range=$('[data-music-volume]',root);musicState.status=$('[data-music-status]',root);
      musicState.play.onclick=()=>{const a=musicState.audio;if(a.paused)tryPlayMusic(true);else{a.pause();const p=readMusicPref();p.userPaused=true;writeMusicPref(p);syncMusicDock();}};
      musicState.mute.onclick=()=>{const a=musicState.audio;a.muted=!a.muted;const p=readMusicPref();p.muted=a.muted;writeMusicPref(p);syncMusicDock();};
      musicState.range.oninput=e=>{const a=musicState.audio,v=Math.max(0,Math.min(100,Number(e.target.value)||0));a.volume=v/100;if(v>0&&a.muted)a.muted=false;$('[data-music-volume-label]',musicState.root).textContent=`${v}%`;const p=readMusicPref();p.volume=v;p.muted=a.muted;writeMusicPref(p);syncMusicDock();};
      musicState.audio.onplay=syncMusicDock;musicState.audio.onpause=syncMusicDock;musicState.audio.onvolumechange=syncMusicDock;
    }
    const pref=readMusicPref(),s=musicState,defaultVolume=Math.max(0,Math.min(100,Number(settings.store_music_volume)||35));
    if(s.url!==settings.store_music_url){s.audio.pause();s.audio.src=settings.store_music_url;s.url=settings.store_music_url;}
    const volume=Number.isFinite(Number(pref.volume))?Math.max(0,Math.min(100,Number(pref.volume))):defaultVolume;
    s.audio.volume=volume/100;s.audio.muted=typeof pref.muted==='boolean'?pref.muted:String(settings.store_music_start_muted)==='1';s.audio.loop=String(settings.store_music_loop)!=='0';s.range.value=String(volume);$('[data-music-volume-label]',s.root).textContent=`${volume}%`;
    syncMusicDock();
    const autoplay=String(settings.store_music_autoplay)!=='0';
    if(autoplay&&!pref.userPaused&&s.audio.paused){
      tryPlayMusic(false);
      if(!s.gestureBound){
        const resume=()=>{if(String(window.DC?.settings?.store_music_enabled)==='1'&&musicState.audio?.paused&&!readMusicPref().userPaused)tryPlayMusic(false);document.removeEventListener('pointerdown',resume);document.removeEventListener('keydown',resume);musicState.gestureBound=false;};
        document.addEventListener('pointerdown',resume,{once:true});document.addEventListener('keydown',resume,{once:true});s.gestureBound=true;
      }
    }
  }
  function applyAppearance(settings={}){
    const bg=String(settings.store_background_url||'');
    const enabled=String(settings.store_background_enabled)==='1'&&Boolean(bg);
    const overlay=Math.max(0,Math.min(95,Number(settings.store_background_overlay)||78))/100;
    document.body.classList.toggle('store-background-enabled',enabled);
    if(enabled){document.body.style.setProperty('--store-background-image',`url("${bg.replace(/"/g,'')}")`);document.body.style.setProperty('--store-background-overlay',String(overlay));}
    else{document.body.style.removeProperty('--store-background-image');document.body.style.removeProperty('--store-background-overlay');}
    ensureMusicDock(settings);
  }

  async function loadBase(){
    const settings=await api('/api/public/settings');window.DC.settings=settings;
    $$('[data-site-name]').forEach(x=>x.textContent=settings.site_name||'DC RECARGAS');$$('[data-logo]').forEach(x=>x.src=settings.logo_url||'/assets/logo.svg');$$('[data-tagline]').forEach(x=>x.textContent=settings.tagline||'');$$('[data-footer-note]').forEach(x=>x.textContent=settings.footer_note||'');$$('[data-support]').forEach(x=>x.textContent=settings.support_text||'WhatsApp directo');$$('[data-rate]').forEach(x=>x.textContent=`S/ ${Number(settings.pen_per_usd||3.75).toFixed(2)} por USD`);$$('[data-storefront-notice]').forEach(x=>x.textContent=settings.storefront_notice||'Atención disponible');$$('[data-hero-title]').forEach(x=>x.textContent=settings.hero_title||'Tienda digital');$$('[data-hero-subtitle]').forEach(x=>x.textContent=settings.hero_subtitle||'');$$('[data-hero-badge]').forEach(x=>x.textContent=settings.hero_badge||'TIENDA DIGITAL');
    const wa=String(settings.whatsapp_number||'').replace(/\D/g,'');$$('[data-whatsapp]').forEach(a=>{a.href=wa?`https://wa.me/${wa}`:'#';a.target='_blank';a.rel='noopener';});
    const y=$('#year');if(y)y.textContent=new Date().getFullYear();applyAppearance(settings);return settings;
  }
  async function loadFooterSocials(){try{const rows=await api('/api/public/social-channels');const el=$('#footerSocials');if(el)el.innerHTML=rows.length?rows.map(x=>x.url?`<a target="_blank" rel="noopener" href="${esc(x.url)}">${esc(x.name)}${x.is_live?' · EN VIVO':''}</a>`:`<span class="muted">${esc(x.name)}${x.is_live?' · EN VIVO':''}</span>`).join(''):'<span class="muted">Canales por configurar</span>';return rows;}catch{return[];}}
  let realtimeSource=null,realtimeBadge=null,realtimeTimer=null;
  function setRealtimeStatus(state,text){
    if(!realtimeBadge){
      realtimeBadge=document.createElement('div');
      realtimeBadge.className='realtime-status';
      realtimeBadge.innerHTML='<span class="realtime-dot"></span><strong></strong>';
      document.body.appendChild(realtimeBadge);
    }
    realtimeBadge.dataset.state=state;
    const label=realtimeBadge.querySelector('strong');if(label)label.textContent=text;
  }
  function startRealtime(){
    if(realtimeSource||!('EventSource' in window))return;
    setRealtimeStatus('connecting','Conectando cambios en vivo');
    realtimeSource=new EventSource('/api/events');
    realtimeSource.addEventListener('connected',e=>{
      setRealtimeStatus('online','Actualización en vivo');
      try{window.DC.revision=JSON.parse(e.data||'{}').revision||0}catch{}
    });
    realtimeSource.addEventListener('content-updated',async e=>{
      let detail={};try{detail=JSON.parse(e.data||'{}')}catch{}
      window.DC.revision=detail.revision||window.DC.revision||0;
      setRealtimeStatus('updated','Cambios publicados');
      clearTimeout(realtimeTimer);
      realtimeTimer=setTimeout(()=>setRealtimeStatus('online','Actualización en vivo'),1800);
      try{await loadBase();await loadFooterSocials();}catch{}
      window.dispatchEvent(new CustomEvent('dc:content-updated',{detail}));
    });
    realtimeSource.onerror=()=>setRealtimeStatus('offline','Reconectando…');
  }
  window.addEventListener('beforeunload',()=>{try{realtimeSource?.close()}catch{}});
  window.DC={$, $$, esc, api, money, toast, productCard, categoryName, loadBase, loadFooterSocials, applyAppearance, startRealtime, settings:null,revision:0};
  loadBase().then(loadFooterSocials).then(startRealtime).catch(e=>{toast(e.message);startRealtime();});
})();
