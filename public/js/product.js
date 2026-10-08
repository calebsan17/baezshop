(async()=>{
  const {$,esc,api,money,categoryName}=window.DC;
  const id=Number(new URLSearchParams(location.search).get('id'));
  if(!id){$('#detail').innerHTML='<div class="empty">Producto no válido.</div>';return;}
  let currentGallery=[];
  async function render(){
    try{
      const [p,settings]=await Promise.all([api(`/api/public/products/${id}`),api('/api/public/settings')]);
      window.DC.settings=settings;window.DC.applyAppearance(settings);
      document.title=`${p.name} · ${settings.site_name}`;
      const usd=(Number(p.price_pen)/(Number(settings.pen_per_usd)||3.75)).toFixed(2);
      const gallery=[{type:'image',url:p.image_url},...(Array.isArray(p.gallery)?p.gallery:[])].filter((x,i,a)=>x.url&&a.findIndex(y=>y.url===x.url)===i);
      currentGallery=gallery;
      const media=gallery[0]||{type:'image',url:p.image_url};
      $('#detail').innerHTML=`<div class="detail-media"><div id="mainMedia">${media.type==='video'?`<video class="detail-main-media video" src="${esc(media.url)}" controls playsinline></video>`:`<img class="detail-main-media" src="${esc(media.url)}" alt="${esc(p.name)}">`}</div>${gallery.length>1?`<div class="media-thumbs">${gallery.map((m,i)=>`<button class="media-thumb" type="button" data-index="${i}" aria-label="Medio ${i+1}">${m.type==='video'?`<video src="${esc(m.url)}" muted></video>`:`<img src="${esc(m.url)}" alt="">`}</button>`).join('')}</div>`:''}</div><div class="detail-info"><div class="product-type">${esc(categoryName(p.category))}</div><h1>${esc(p.name)}</h1><p class="detail-desc">${esc(p.description||p.subtitle||'Producto digital disponible.')}</p>${p.old_price_pen?`<div class="old">Antes ${money(p.old_price_pen)}</div>`:''}<div class="detail-price">${money(p.price_pen)}</div><div class="usd">≈ $ ${usd} USD</div><div class="detail-actions">${p.stock_status==='out'?'<span class="btn btn-dark">Sin stock</span>':`<a class="btn btn-primary" href="/checkout.html?product=${p.id}">Comprar ahora</a>`}<a class="btn btn-outline" href="/free-fire.html">Volver al catálogo</a></div></div>`;
      document.querySelectorAll('.media-thumb').forEach(b=>b.onclick=()=>{const m=currentGallery[Number(b.dataset.index)];$('#mainMedia').innerHTML=m.type==='video'?`<video class="detail-main-media video" src="${esc(m.url)}" controls autoplay playsinline></video>`:`<img class="detail-main-media" src="${esc(m.url)}" alt="${esc(p.name)}">`;});
    }catch(e){$('#detail').innerHTML=`<div class="empty">${esc(e.message)}</div>`;}
  }
  await render();
  let t=null;window.addEventListener('dc:content-updated',()=>{clearTimeout(t);t=setTimeout(render,150);});
})();
