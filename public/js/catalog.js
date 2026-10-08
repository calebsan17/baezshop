(async()=>{
  const {$,esc,api,productCard}=window.DC;
  let settings=window.DC.settings||await window.DC.loadBase();
  const params=new URLSearchParams(location.search);
  let tab=params.get('tab')||'diamonds';
  if(!['diamonds','accounts','entertainment'].includes(tab))tab='diamonds';
  const titles={
    diamonds:['Free Fire','Diamantes y extras disponibles','Recargas y extras de Free Fire. El ID solo se solicita al comprar.'],
    accounts:['Cuentas Free Fire','Cuentas disponibles','Cuentas con galería de fotos y videos configurada por el administrador.'],
    entertainment:['Entretenimiento','Servicios digitales disponibles','Compra simplificada: nombre, método de pago y voucher.']
  };
  async function render(){
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    $('#catalogTitle').textContent=titles[tab][0];
    $('#sectionHeading').textContent=titles[tab][1];
    $('#catalogSubtitle').textContent=titles[tab][2];
    try{
      settings=await api('/api/public/settings');
      const all=await api('/api/public/products');
      const rows=tab==='diamonds'?all.filter(p=>['diamonds','extras'].includes(p.category)):all.filter(p=>p.category===tab);
      $('#productCount').textContent=`${rows.length} producto${rows.length===1?'':'s'}`;
      $('#productGrid').innerHTML=rows.length?rows.map(p=>productCard(p,settings.pen_per_usd)).join(''):'<div class="empty">No hay productos visibles en esta categoría.</div>';
    }catch(e){$('#productGrid').innerHTML=`<div class="empty">${esc(e.message)}</div>`;}
  }
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;history.replaceState(null,'',`?tab=${tab}`);render();});
  await render();
  let realtimeTimer=null;
  window.addEventListener('dc:content-updated',()=>{clearTimeout(realtimeTimer);realtimeTimer=setTimeout(render,150);});
  const secs=Math.max(15,Number(settings.auto_refresh_seconds)||30);
  setInterval(render,secs*1000);
})();
