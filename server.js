const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const DB = require('./db');

const ROOT = __dirname;
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const sessions = new Map();
const rate = new Map();
const mime = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mp4':'video/mp4','.webm':'video/webm'
};

const sseClients = new Set();
function broadcastChange(evt){
  const packet = `event: content-updated\ndata: ${JSON.stringify(evt)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(packet); } catch { sseClients.delete(res); }
  }
}
DB.onChange(broadcastChange);

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}
function send(res, status, payload, headers = {}) {
  securityHeaders(res);
  for (const [k,v] of Object.entries(headers)) res.setHeader(k,v);
  if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    payload = JSON.stringify(payload);
  }
  res.statusCode = status;
  res.end(payload);
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{
    const i=x.indexOf('='); return [decodeURIComponent(x.slice(0,i)), decodeURIComponent(x.slice(i+1))];
  }));
}
function auth(req) {
  const token = cookies(req).dc_session;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) return null;
  const user = DB.get().users.find(u=>u.id===session.userId && u.active);
  if (!user) return null;
  session.expires = Date.now() + 8*60*60*1000;
  return user;
}
function publicUser(u) { return {id:u.id,username:u.username,display_name:u.display_name,role:u.role,active:u.active,created_at:u.created_at,updated_at:u.updated_at}; }
function requireAuth(req,res){ const u=auth(req); if(!u){send(res,401,{error:'Sesión requerida'});return null;} return u; }
function requireOwner(req,res){ const u=requireAuth(req,res); if(!u)return null; if(u.role!=='owner'){send(res,403,{error:'Solo el jefe puede realizar esta acción'});return null;} return u; }
function allow(req,scope,limit=30,windowMs=10*60*1000){ const ip=req.socket.remoteAddress||'local',key=`${scope}:${ip}`,now=Date.now();const arr=(rate.get(key)||[]).filter(t=>now-t<windowMs);if(arr.length>=limit)return false;arr.push(now);rate.set(key,arr);return true; }
function slugify(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || `producto-${Date.now()}`; }
function routeMatch(pathname,re){ return pathname.match(re)||null; }
function isUsername(v){ return /^[A-Za-z0-9._-]{4,30}$/.test(String(v||'')); }
function safeText(v,max=4000){ return String(v??'').trim().slice(0,max); }
function safeLocalMediaUrl(v){ const s=safeText(v,500); return (!s || /^\/(uploads|assets|media)\/[A-Za-z0-9._\/-]+$/.test(s)) ? s : ''; }
function safeExternalUrl(v){ const s=safeText(v,800); if(!s)return ''; try{const u=new URL(s); return ['https:','http:'].includes(u.protocol)?s:'';}catch{return '';} }
function clampInt(v,min,max,def){ const n=Math.trunc(Number(v)); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):def; }
async function body(req,max=82*1024*1024){ return await new Promise((resolve,reject)=>{ let size=0,chunks=[]; req.on('data',c=>{size+=c.length;if(size>max){reject(Object.assign(new Error('Solicitud demasiado grande'),{status:413}));req.destroy();}else chunks.push(c)});req.on('end',()=>{if(!chunks.length)return resolve({});try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Object.assign(new Error('JSON inválido'),{status:400}))}});req.on('error',reject); }); }
function staticFile(req,res,pathname){
  let base=PUBLIC, rel=pathname;
  if(pathname.startsWith('/uploads/')){base=UPLOADS;rel=pathname.slice('/uploads'.length);}
  if(rel==='/'||rel==='')rel='/index.html';
  const full=path.resolve(base,'.'+rel);
  if(full!==base && !full.startsWith(base+path.sep)) return false;
  let file=full;
  if(!fs.existsSync(file)&&!path.extname(file)&&fs.existsSync(file+'.html'))file+='.html';
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return false;
  securityHeaders(res);res.setHeader('Content-Type',mime[path.extname(file).toLowerCase()]||'application/octet-stream');res.setHeader('Cache-Control',pathname.startsWith('/uploads/')?'public, max-age=86400':'no-cache');res.statusCode=200;fs.createReadStream(file).pipe(res);return true;
}
function safeGallery(raw,settings){
  const arr=Array.isArray(raw)?raw:[];
  const imgLimit=clampInt(settings.account_image_limit,1,30,8), vidLimit=clampInt(settings.account_video_limit,0,10,2);
  let images=0,videos=0; const out=[];
  for(const item of arr){
    const type=item&&item.type==='video'?'video':'image'; const url=safeLocalMediaUrl(item&&item.url); if(!url)continue;
    if(type==='image'){if(images>=imgLimit)continue;images++;} else {if(videos>=vidLimit)continue;videos++;}
    out.push({type,url});
  }
  return out;
}
function safeProduct(b,existingId){
  const d=DB.get(),cats=new Set(['diamonds','accounts','extras','entertainment']);
  const name=safeText(b.name,100),category=safeText(b.category,30),price=Number(b.price_pen),old=b.old_price_pen===''||b.old_price_pen==null?null:Number(b.old_price_pen);
  if(!name)throw new Error('El nombre es obligatorio'); if(!cats.has(category))throw new Error('Categoría inválida'); if(!Number.isFinite(price)||price<0)throw new Error('Precio inválido'); if(old!=null&&(!Number.isFinite(old)||old<0))throw new Error('Precio anterior inválido');
  let slug=slugify(b.slug||name); if(d.products.some(p=>p.slug===slug&&p.id!==existingId))slug+=`-${existingId||Date.now().toString(36)}`;
  return {name,slug,category,price_pen:price,old_price_pen:old,subtitle:safeText(b.subtitle,160),description:safeText(b.description,2500),image_url:safeLocalMediaUrl(b.image_url)||'/assets/logo.svg',gallery:category==='accounts'?safeGallery(b.gallery,d.settings):[],stock_status:b.stock_status==='out'?'out':'available',featured:b.featured?1:0,active:b.active===false||b.active===0?0:1,sort_order:clampInt(b.sort_order,-9999,9999,0)};
}
function publicSettings(s){
  const keys=['site_name','tagline','whatsapp_number','whatsapp_channel_url','pen_per_usd','logo_url','hero_title','hero_subtitle','hero_badge','support_text','footer_note','account_image_limit','account_video_limit','auto_refresh_seconds','storefront_notice','login_music_url','login_cover_url','store_background_url','store_background_enabled','store_background_overlay','store_music_url','store_music_enabled','store_music_volume','store_music_autoplay','store_music_loop','store_music_start_muted'];
  return Object.fromEntries(keys.map(k=>[k,s[k]??'']));
}

const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),p=url.pathname,d=DB.get();

  if(req.method==='GET'&&p==='/health'){
    const h=await DB.health(); return send(res,h.ok?200:503,{status:h.ok?'ok':'error',...h,uptime_seconds:Math.round(process.uptime())});
  }
  if(req.method==='GET'&&p==='/api/events'){
    securityHeaders(res);
    res.statusCode=200;
    res.setHeader('Content-Type','text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control','no-cache, no-transform');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.write(`retry: 2500\nevent: connected\ndata: ${JSON.stringify({revision:DB.getRevision(),storage:DB.mode(),at:new Date().toISOString()})}\n\n`);
    sseClients.add(res);
    const heartbeat=setInterval(()=>{try{res.write(`: heartbeat ${Date.now()}\n\n`)}catch{}},20000);
    req.on('close',()=>{clearInterval(heartbeat);sseClients.delete(res);});
    return;
  }
  const mediaMatch=routeMatch(p,/^\/media\/([0-9a-f-]{36})$/i);
  if(req.method==='GET'&&mediaMatch){
    const mediaRow=await DB.getMedia(mediaMatch[1]);
    if(!mediaRow)return send(res,404,{error:'Archivo no encontrado'});
    securityHeaders(res);res.statusCode=200;res.setHeader('Content-Type',mediaRow.mime);res.setHeader('Content-Length',String(mediaRow.size_bytes));res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.end(mediaRow.bytes);return;
  }

  // PUBLIC
  if(req.method==='GET'&&p==='/api/public/settings') return send(res,200,publicSettings(d.settings));
  if(req.method==='GET'&&p==='/api/public/social-channels') return send(res,200,d.social_channels.filter(x=>x.active||x.is_live).sort((a,b)=>(b.is_live-a.is_live)||(a.sort_order-b.sort_order)||(a.id-b.id)));
  if(req.method==='GET'&&p==='/api/public/products'){
    let rows=d.products.filter(x=>x.active); const c=url.searchParams.get('category');
    if(c==='diamonds-accounts')rows=rows.filter(x=>['diamonds','accounts'].includes(x.category)); else if(c)rows=rows.filter(x=>x.category===c);
    rows.sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id); return send(res,200,rows);
  }
  let m=routeMatch(p,/^\/api\/public\/products\/(\d+)$/);
  if(req.method==='GET'&&m){const x=d.products.find(v=>v.id===Number(m[1])&&v.active);return x?send(res,200,x):send(res,404,{error:'Producto no encontrado'});}
  if(req.method==='GET'&&p==='/api/public/faqs')return send(res,200,d.faqs.filter(x=>x.active).sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id));
  if(req.method==='GET'&&p==='/api/public/payment-methods')return send(res,200,d.payment_methods.filter(x=>x.active).sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id));
  if(req.method==='GET'&&p==='/api/public/recommendations'){
    const rows=[...d.recommendations].filter(x=>x.status==='approved').sort((a,b)=>(b.featured-a.featured)||(new Date(b.created_at)-new Date(a.created_at))||(b.id-a.id)).slice(0,18);
    return send(res,200,rows.map(({id,customer_name,rating,message,featured,created_at})=>({id,customer_name,rating,message,featured,created_at})));
  }
  if(req.method==='POST'&&p==='/api/public/recommendations'){
    if(!allow(req,'recommendations',5,60*60*1000))return send(res,429,{error:'Has enviado varias recomendaciones. Intenta nuevamente más tarde.'});
    const b=await body(req,64*1024);if(safeText(b.website,120))return send(res,201,{ok:true,message:'Gracias por tu recomendación.'});
    const customer_name=safeText(b.customer_name,60),message=safeText(b.message,700),rating=clampInt(b.rating,1,5,0);
    if(customer_name.length<2)return send(res,400,{error:'Ingresa un nombre de al menos 2 caracteres'});
    if(message.length<15)return send(res,400,{error:'Escribe una recomendación de al menos 15 caracteres'});
    if(!rating)return send(res,400,{error:'Selecciona una calificación del 1 al 5'});
    const x={id:DB.nextId('recommendations'),customer_name,rating,message,status:'pending',featured:0,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    d.recommendations.push(x);await DB.save('content-update');return send(res,201,{ok:true,message:'Gracias. Tu recomendación fue enviada y quedará visible después de ser revisada.'});
  }
  if(req.method==='POST'&&p==='/api/orders'){
    if(!allow(req,'orders',40))return send(res,429,{error:'Demasiados intentos. Intenta nuevamente en unos minutos.'});
    const b=await body(req,512*1024),product=d.products.find(x=>x.id===Number(b.product_id)&&x.active),pm=d.payment_methods.find(x=>x.id===Number(b.payment_method_id)&&x.active);
    if(!product||product.stock_status==='out')return send(res,400,{error:'Producto no disponible'}); if(!pm)return send(res,400,{error:'Método de pago no disponible'});
    const needsGameId=['diamonds','extras'].includes(product.category), name=safeText(b.customer_name,80), gameId=safeText(b.customer_game_id,40);
    if(needsGameId&&!/^[A-Za-z0-9._-]{4,40}$/.test(gameId))return send(res,400,{error:'Ingresa un ID de Free Fire válido'});
    if(!needsGameId&&name.length<2)return send(res,400,{error:'Ingresa tu nombre para continuar'});
    const r=Number(d.settings.pen_per_usd)>0?Number(d.settings.pen_per_usd):3.75;
    const o={id:DB.nextId('orders'),code:`DC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,product_id:product.id,product_name:product.name,product_subtitle:product.subtitle,product_category:product.category,customer_game_id:needsGameId?gameId:'',customer_name:name,payment_method_id:pm.id,payment_name:pm.name,price_pen:Number(product.price_pen),price_usd:Number((product.price_pen/r).toFixed(2)),status:'pending',notes:'',created_at:new Date().toISOString()};
    d.orders.push(o);await DB.save('content-update');return send(res,201,{order:o,settings:{site_name:d.settings.site_name,whatsapp_number:d.settings.whatsapp_number,logo_url:d.settings.logo_url}});
  }

  // AUTH
  if(req.method==='POST'&&p==='/api/auth/login'){
    if(!allow(req,'login',20))return send(res,429,{error:'Demasiados intentos. Intenta luego.'});
    const b=await body(req,64*1024),u=d.users.find(x=>x.username===safeText(b.username,40));
    if(!u||!u.active||!DB.verifyPassword(String(b.password||''),u.password_hash))return send(res,401,{error:'Usuario o contraseña incorrectos'});
    const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{userId:u.id,expires:Date.now()+8*60*60*1000});const secure=process.env.NODE_ENV==='production'?'; Secure':'';
    return send(res,200,{user:publicUser(u)},{'Set-Cookie':`dc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`});
  }
  if(req.method==='POST'&&p==='/api/auth/logout'){const t=cookies(req).dc_session;if(t)sessions.delete(t);return send(res,200,{ok:true},{'Set-Cookie':'dc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
  if(req.method==='GET'&&p==='/api/auth/me'){const u=requireAuth(req,res);if(u)return send(res,200,{user:publicUser(u)});return;}
  if(req.method==='PUT'&&p==='/api/auth/profile'){
    const u=requireAuth(req,res);if(!u)return;const b=await body(req,64*1024);if(!DB.verifyPassword(String(b.current_password||''),u.password_hash))return send(res,400,{error:'Confirma tu contraseña actual'});
    const username=safeText(b.username,30),display=safeText(b.display_name,80);if(!isUsername(username))return send(res,400,{error:'Usuario: 4 a 30 caracteres; usa letras, números, punto, guion o guion bajo'});if(display.length<2)return send(res,400,{error:'Nombre visible inválido'});if(d.users.some(x=>x.id!==u.id&&x.username.toLowerCase()===username.toLowerCase()))return send(res,409,{error:'Ese usuario ya existe'});
    u.username=username;u.display_name=display;u.updated_at=new Date().toISOString();await DB.save('content-update');return send(res,200,{user:publicUser(u)});
  }
  if(req.method==='POST'&&p==='/api/auth/change-password'){
    const u=requireAuth(req,res);if(!u)return;const b=await body(req,64*1024);if(!DB.verifyPassword(String(b.current_password||''),u.password_hash))return send(res,400,{error:'Contraseña actual incorrecta'});const np=String(b.new_password||'');if(np.length<8||np.length>128)return send(res,400,{error:'La nueva contraseña debe tener entre 8 y 128 caracteres'});u.password_hash=DB.hashPassword(np);u.updated_at=new Date().toISOString();await DB.save('content-update');return send(res,200,{ok:true});
  }

  // DASHBOARD
  if(req.method==='GET'&&p==='/api/admin/dashboard'){
    const u=requireAuth(req,res);if(!u)return;const stats={products:d.products.filter(x=>x.active).length,orders:d.orders.length,pending:d.orders.filter(x=>['pending','paid','processing'].includes(x.status)).length,sales_pen:d.orders.filter(x=>x.status==='completed').reduce((a,x)=>a+Number(x.price_pen),0),socials_live:d.social_channels.filter(x=>x.active&&x.is_live).length,recommendations_pending:d.recommendations.filter(x=>x.status==='pending').length};return send(res,200,{stats,user:publicUser(u)});
  }

  // PRODUCTS CRUD
  if(req.method==='GET'&&p==='/api/admin/products'){if(!requireAuth(req,res))return;return send(res,200,[...d.products].sort((a,b)=>a.category.localeCompare(b.category)||a.sort_order-b.sort_order||a.id-b.id));}
  if(req.method==='POST'&&p==='/api/admin/products'){
    if(!requireAuth(req,res))return;const b=await body(req);let x;try{x=safeProduct(b)}catch(e){return send(res,400,{error:e.message})}x.id=DB.nextId('products');x.created_at=x.updated_at=new Date().toISOString();d.products.push(x);await DB.save('content-update');return send(res,201,x);
  }
  m=routeMatch(p,/^\/api\/admin\/products\/(\d+)$/);
  if(m&&req.method==='PUT'){
    if(!requireAuth(req,res))return;const x=d.products.find(v=>v.id===Number(m[1]));if(!x)return send(res,404,{error:'Producto no encontrado'});let v;try{v=safeProduct(await body(req),x.id)}catch(e){return send(res,400,{error:e.message})}Object.assign(x,v,{updated_at:new Date().toISOString()});await DB.save('content-update');return send(res,200,x);
  }
  if(m&&req.method==='DELETE'){
    if(!requireAuth(req,res))return;const id=Number(m[1]);const x=d.products.find(v=>v.id===id);if(!x)return send(res,404,{error:'Producto no encontrado'});if(d.orders.some(o=>o.product_id===id))x.active=0;else d.products=d.products.filter(v=>v.id!==id);await DB.save('content-update');return send(res,200,{ok:true});
  }

  // ORDERS
  if(req.method==='GET'&&p==='/api/admin/orders'){if(!requireAuth(req,res))return;return send(res,200,[...d.orders].sort((a,b)=>b.id-a.id).slice(0,1000));}
  m=routeMatch(p,/^\/api\/admin\/orders\/(\d+)$/);
  if(m&&req.method==='PATCH'){
    if(!requireAuth(req,res))return;const b=await body(req,64*1024),allowed=new Set(['pending','paid','processing','completed','cancelled']);if(!allowed.has(String(b.status)))return send(res,400,{error:'Estado inválido'});const o=d.orders.find(x=>x.id===Number(m[1]));if(!o)return send(res,404,{error:'Pedido no encontrado'});o.status=String(b.status);o.notes=safeText(b.notes??o.notes,500);await DB.save('content-update');return send(res,200,o);
  }

  // FAQ CRUD
  if(req.method==='GET'&&p==='/api/admin/faqs'){if(!requireAuth(req,res))return;return send(res,200,[...d.faqs].sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id));}
  if(req.method==='POST'&&p==='/api/admin/faqs'){
    if(!requireAuth(req,res))return;const b=await body(req,128*1024),q=safeText(b.question,300),a=safeText(b.answer,3000);if(!q||!a)return send(res,400,{error:'Pregunta y respuesta son obligatorias'});const x={id:DB.nextId('faqs'),question:q,answer:a,sort_order:clampInt(b.sort_order,-9999,9999,0),active:b.active===false?0:1};d.faqs.push(x);await DB.save('content-update');return send(res,201,x);
  }
  m=routeMatch(p,/^\/api\/admin\/faqs\/(\d+)$/);
  if(m&&req.method==='PUT'){
    if(!requireAuth(req,res))return;const x=d.faqs.find(v=>v.id===Number(m[1])),b=await body(req,128*1024);if(!x)return send(res,404,{error:'Pregunta no encontrada'});const q=safeText(b.question,300),a=safeText(b.answer,3000);if(!q||!a)return send(res,400,{error:'Pregunta y respuesta son obligatorias'});Object.assign(x,{question:q,answer:a,sort_order:clampInt(b.sort_order,-9999,9999,0),active:b.active===false?0:1});await DB.save('content-update');return send(res,200,x);
  }
  if(m&&req.method==='DELETE'){if(!requireAuth(req,res))return;const before=d.faqs.length;d.faqs=d.faqs.filter(v=>v.id!==Number(m[1]));if(before===d.faqs.length)return send(res,404,{error:'Pregunta no encontrada'});await DB.save('content-update');return send(res,200,{ok:true});}

  // RECOMMENDATIONS / REVIEWS
  if(req.method==='GET'&&p==='/api/admin/recommendations'){
    if(!requireAuth(req,res))return;return send(res,200,[...d.recommendations].sort((a,b)=>b.id-a.id));
  }
  m=routeMatch(p,/^\/api\/admin\/recommendations\/(\d+)$/);
  if(m&&req.method==='PATCH'){
    if(!requireAuth(req,res))return;const x=d.recommendations.find(v=>v.id===Number(m[1]));if(!x)return send(res,404,{error:'Recomendación no encontrada'});const b=await body(req,64*1024);
    if('status'in b){const allowed=new Set(['pending','approved','hidden']);if(!allowed.has(String(b.status)))return send(res,400,{error:'Estado inválido'});x.status=String(b.status);}
    if('featured'in b)x.featured=b.featured?1:0;x.updated_at=new Date().toISOString();await DB.save('content-update');return send(res,200,x);
  }
  if(m&&req.method==='DELETE'){
    if(!requireAuth(req,res))return;const before=d.recommendations.length;d.recommendations=d.recommendations.filter(v=>v.id!==Number(m[1]));if(before===d.recommendations.length)return send(res,404,{error:'Recomendación no encontrada'});await DB.save('content-update');return send(res,200,{ok:true});
  }

  // SETTINGS
  if(req.method==='GET'&&p==='/api/admin/settings'){if(!requireAuth(req,res))return;return send(res,200,d.settings);}
  if(req.method==='PUT'&&p==='/api/admin/settings'){
    if(!requireOwner(req,res))return;const b=await body(req,256*1024);const allowed=new Set(['site_name','tagline','whatsapp_number','whatsapp_channel_url','pen_per_usd','logo_url','hero_title','hero_subtitle','hero_badge','login_music_url','support_text','footer_note','account_image_limit','account_video_limit','auto_refresh_seconds','login_cover_url','storefront_notice','store_background_url','store_background_enabled','store_background_overlay','store_music_url','store_music_enabled','store_music_volume','store_music_autoplay','store_music_loop','store_music_start_muted']);
    if('pen_per_usd'in b&&!(Number(b.pen_per_usd)>0))return send(res,400,{error:'Tipo de cambio inválido'});
    if('account_image_limit'in b)b.account_image_limit=String(clampInt(b.account_image_limit,1,30,8));if('account_video_limit'in b)b.account_video_limit=String(clampInt(b.account_video_limit,0,10,2));if('auto_refresh_seconds'in b)b.auto_refresh_seconds=String(clampInt(b.auto_refresh_seconds,5,120,12));if('store_background_overlay'in b)b.store_background_overlay=String(clampInt(b.store_background_overlay,0,95,78));if('store_music_volume'in b)b.store_music_volume=String(clampInt(b.store_music_volume,0,100,35));for(const key of ['store_background_enabled','store_music_enabled','store_music_autoplay','store_music_loop','store_music_start_muted'])if(key in b)b[key]=String(b[key])==='1'?'1':'0';
    for(const[k,v]of Object.entries(b))if(allowed.has(k)){
      if(['logo_url','login_music_url','login_cover_url','store_background_url','store_music_url'].includes(k)) d.settings[k]=safeLocalMediaUrl(v); else if(k==='whatsapp_channel_url') d.settings[k]=safeExternalUrl(v); else d.settings[k]=safeText(v,2000);
    }
    await DB.save('content-update');return send(res,200,d.settings);
  }

  // PAYMENT METHODS CRUD
  if(req.method==='GET'&&p==='/api/admin/payment-methods'){if(!requireAuth(req,res))return;return send(res,200,[...d.payment_methods].sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id));}
  if(req.method==='POST'&&p==='/api/admin/payment-methods'){
    if(!requireOwner(req,res))return;const b=await body(req,128*1024),name=safeText(b.name,80);if(!name)return send(res,400,{error:'Nombre obligatorio'});const x={id:DB.nextId('payment_methods'),name,instructions:safeText(b.instructions,1000),image_url:safeLocalMediaUrl(b.image_url),active:b.active===false?0:1,sort_order:clampInt(b.sort_order,-9999,9999,0)};d.payment_methods.push(x);await DB.save('content-update');return send(res,201,x);
  }
  m=routeMatch(p,/^\/api\/admin\/payment-methods\/(\d+)$/);
  if(m&&req.method==='PUT'){
    if(!requireOwner(req,res))return;const x=d.payment_methods.find(v=>v.id===Number(m[1])),b=await body(req,128*1024);if(!x)return send(res,404,{error:'Método no encontrado'});const name=safeText(b.name,80);if(!name)return send(res,400,{error:'Nombre obligatorio'});Object.assign(x,{name,instructions:safeText(b.instructions,1000),image_url:safeLocalMediaUrl(b.image_url),active:b.active===false?0:1,sort_order:clampInt(b.sort_order,-9999,9999,0)});await DB.save('content-update');return send(res,200,x);
  }
  if(m&&req.method==='DELETE'){
    if(!requireOwner(req,res))return;const id=Number(m[1]),x=d.payment_methods.find(v=>v.id===id);if(!x)return send(res,404,{error:'Método no encontrado'});if(d.orders.some(o=>o.payment_method_id===id))x.active=0;else d.payment_methods=d.payment_methods.filter(v=>v.id!==id);await DB.save('content-update');return send(res,200,{ok:true});
  }

  // SOCIAL CHANNELS CRUD
  if(req.method==='GET'&&p==='/api/admin/social-channels'){if(!requireAuth(req,res))return;return send(res,200,[...d.social_channels].sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id));}
  if(req.method==='POST'&&p==='/api/admin/social-channels'){
    if(!requireAuth(req,res))return;const b=await body(req,128*1024),name=safeText(b.name,80),urlx=safeExternalUrl(b.url);if(!name)return send(res,400,{error:'Nombre obligatorio'});if(b.url&&!urlx)return send(res,400,{error:'Enlace inválido'});const x={id:DB.nextId('social_channels'),name,platform:safeText(b.platform,40)||'Red social',handle:safeText(b.handle,80),url:urlx,image_url:safeLocalMediaUrl(b.image_url),button_text:safeText(b.button_text,50)||'Visitar canal',is_live:b.is_live?1:0,active:b.active===false?0:1,sort_order:clampInt(b.sort_order,-9999,9999,0)};d.social_channels.push(x);await DB.save('content-update');return send(res,201,x);
  }
  m=routeMatch(p,/^\/api\/admin\/social-channels\/(\d+)$/);
  if(m&&req.method==='PUT'){
    if(!requireAuth(req,res))return;const x=d.social_channels.find(v=>v.id===Number(m[1])),b=await body(req,128*1024);if(!x)return send(res,404,{error:'Canal no encontrado'});const name=safeText(b.name,80),urlx=safeExternalUrl(b.url);if(!name)return send(res,400,{error:'Nombre obligatorio'});if(b.url&&!urlx)return send(res,400,{error:'Enlace inválido'});Object.assign(x,{name,platform:safeText(b.platform,40)||'Red social',handle:safeText(b.handle,80),url:urlx,image_url:safeLocalMediaUrl(b.image_url),button_text:safeText(b.button_text,50)||'Visitar canal',is_live:b.is_live?1:0,active:b.active===false?0:1,sort_order:clampInt(b.sort_order,-9999,9999,0)});await DB.save('content-update');return send(res,200,x);
  }
  if(m&&req.method==='PATCH'){
    if(!requireAuth(req,res))return;const x=d.social_channels.find(v=>v.id===Number(m[1])),b=await body(req,64*1024);if(!x)return send(res,404,{error:'Canal no encontrado'});if('is_live'in b){x.is_live=b.is_live?1:0;if(x.is_live)x.active=1;}if('active'in b){x.active=b.active?1:0;if(!x.active)x.is_live=0;}await DB.save('content-update');return send(res,200,x);
  }
  if(m&&req.method==='DELETE'){if(!requireAuth(req,res))return;const before=d.social_channels.length;d.social_channels=d.social_channels.filter(v=>v.id!==Number(m[1]));if(before===d.social_channels.length)return send(res,404,{error:'Canal no encontrado'});await DB.save('content-update');return send(res,200,{ok:true});}

  // USERS CRUD (OWNER)
  if(req.method==='GET'&&p==='/api/admin/users'){if(!requireOwner(req,res))return;return send(res,200,d.users.map(publicUser));}
  if(req.method==='POST'&&p==='/api/admin/users'){
    if(!requireOwner(req,res))return;const b=await body(req,64*1024),username=safeText(b.username,30),display=safeText(b.display_name,80),password=String(b.password||'');if(!isUsername(username))return send(res,400,{error:'Usuario: 4 a 30 caracteres'});if(display.length<2)return send(res,400,{error:'Nombre obligatorio'});if(password.length<8||password.length>128)return send(res,400,{error:'Contraseña: mínimo 8 caracteres'});if(d.users.some(x=>x.username.toLowerCase()===username.toLowerCase()))return send(res,409,{error:'El usuario ya existe'});const x={id:DB.nextId('users'),username,display_name:display,password_hash:DB.hashPassword(password),role:'admin',active:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};d.users.push(x);await DB.save('content-update');return send(res,201,publicUser(x));
  }
  m=routeMatch(p,/^\/api\/admin\/users\/(\d+)$/);
  if(m&&req.method==='PUT'){
    const owner=requireOwner(req,res);if(!owner)return;const x=d.users.find(v=>v.id===Number(m[1])),b=await body(req,64*1024);if(!x)return send(res,404,{error:'Usuario no encontrado'});const username=safeText(b.username,x.username.length?30:30)||x.username,display=safeText(b.display_name,80)||x.display_name;if(!isUsername(username))return send(res,400,{error:'Usuario inválido'});if(d.users.some(v=>v.id!==x.id&&v.username.toLowerCase()===username.toLowerCase()))return send(res,409,{error:'Ese usuario ya existe'});x.username=username;x.display_name=display;if(x.role!=='owner'&&'active'in b)x.active=b.active?1:0;if(b.password){const pw=String(b.password);if(pw.length<8||pw.length>128)return send(res,400,{error:'Contraseña: mínimo 8 caracteres'});x.password_hash=DB.hashPassword(pw);}x.updated_at=new Date().toISOString();await DB.save('content-update');return send(res,200,publicUser(x));
  }
  if(m&&req.method==='DELETE'){
    if(!requireOwner(req,res))return;const x=d.users.find(v=>v.id===Number(m[1]));if(!x)return send(res,404,{error:'Usuario no encontrado'});if(x.role==='owner')return send(res,400,{error:'No se puede eliminar la cuenta del jefe'});d.users=d.users.filter(v=>v.id!==x.id);await DB.save('content-update');return send(res,200,{ok:true});
  }

  // FILE UPLOAD (base64 JSON)
  if(req.method==='POST'&&p==='/api/admin/upload'){
    if(!requireAuth(req,res))return;const b=await body(req,82*1024*1024),mt=safeText(b.mime,80),raw=String(b.data||'');
    const allowed={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','audio/mpeg':'.mp3','audio/wav':'.wav','audio/ogg':'.ogg','audio/mp4':'.m4a','video/mp4':'.mp4','video/webm':'.webm'};
    const ext=allowed[mt];if(!ext)return send(res,400,{error:'Formato no permitido'});let buf;try{buf=Buffer.from(raw,'base64')}catch{return send(res,400,{error:'Archivo inválido'})}const isVideo=mt.startsWith('video/'),isAudio=mt.startsWith('audio/'),max=isVideo?50*1024*1024:(isAudio?20*1024*1024:10*1024*1024);if(!buf.length||buf.length>max)return send(res,400,{error:`Archivo inválido o mayor a ${Math.round(max/1024/1024)} MB`});const mediaUrl=await DB.putMedia(mt,buf);return send(res,201,{url:mediaUrl,type:isVideo?'video':isAudio?'audio':'image',persistent:DB.mode()==='postgres'});
  }

  if(staticFile(req,res,p))return;
  send(res,404,{error:'No encontrado'});
}catch(e){console.error(e);if(!res.headersSent)send(res,e.status||500,{error:e.message||'Error interno'});else res.end();}});

async function start(){
  await DB.init();
  server.listen(PORT,HOST,()=>{
    console.log(`BAEZSHOP V3 listo en http://${HOST}:${PORT}`);
    console.log(`Persistencia: ${DB.mode()} · Tiempo real: SSE + PostgreSQL NOTIFY`);
  });
}
start().catch(err=>{console.error('No se pudo iniciar BAEZSHOP:',err);process.exit(1);});
process.on('SIGTERM',async()=>{await DB.close();server.close(()=>process.exit(0));});
process.on('SIGINT',async()=>{await DB.close();server.close(()=>process.exit(0));});
