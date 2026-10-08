const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const SEED_FILE = path.join(ROOT, 'seed.json');
const UPLOADS = path.join(ROOT, 'uploads');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');
const events = new EventEmitter();
let data = null;
let revision = 0;
let pool = null;
let listener = null;
let saveChain = Promise.resolve();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, expected] = String(stored).split(':');
    const actual = crypto.scryptSync(String(password), salt, 64);
    const exp = Buffer.from(expected, 'hex');
    return exp.length === actual.length && crypto.timingSafeEqual(exp, actual);
  } catch { return false; }
}
function now(){ return new Date().toISOString(); }
function deepClone(v){ return JSON.parse(JSON.stringify(v)); }
function readJson(file){ try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function baseSeed(){
  const fromStore = readJson(DB_FILE);
  const fromSeed = readJson(SEED_FILE);
  const s = deepClone(fromStore || fromSeed || {counters:{},users:[],settings:{},products:[],faqs:[],payment_methods:[],social_channels:[],recommendations:[],orders:[]});
  if (!Array.isArray(s.users)) s.users = [];
  if (!s.users.length) {
    s.users.push({id:1,username:'dcbaez2026',display_name:'Jefe DC',password_hash:hashPassword(process.env.OWNER_PASSWORD || 'baez1234'),role:'owner',active:1,created_at:now(),updated_at:now()});
  }
  const owner = s.users.find(u=>u.role==='owner') || s.users[0];
  if (owner) {
    if (process.env.OWNER_USERNAME) owner.username = String(process.env.OWNER_USERNAME).trim().slice(0,30);
    if (process.env.OWNER_DISPLAY_NAME) owner.display_name = String(process.env.OWNER_DISPLAY_NAME).trim().slice(0,80);
    if (process.env.OWNER_PASSWORD) owner.password_hash = hashPassword(process.env.OWNER_PASSWORD);
    owner.updated_at = now();
  }
  return s;
}

function migrate(){
  data ||= {};
  data.counters ||= {};
  for (const key of ['users','products','faqs','payment_methods','orders','social_channels','recommendations']) data.counters[key] ||= 0;
  data.settings ||= {};
  const defaults = {
    site_name:'BAEZSHOP', tagline:'Recargas, cuentas y entretenimiento digital con atención directa.', whatsapp_number:'51999999999', whatsapp_channel_url:'', pen_per_usd:'3.75', logo_url:'/assets/logo.svg', hero_title:'Todo tu entretenimiento digital en un solo lugar', hero_subtitle:'Compra diamantes, extras, cuentas y servicios digitales con un proceso claro, rápido y profesional.', hero_badge:'TIENDA DIGITAL', login_music_url:'', store_background_url:'', store_background_enabled:'0', store_background_overlay:'78', store_music_url:'', store_music_enabled:'0', store_music_volume:'35', store_music_autoplay:'1', store_music_loop:'1', store_music_start_muted:'0', support_text:'Atención directa por WhatsApp', footer_note:'Entrega coordinada · Pago seguro · Soporte directo', account_image_limit:'8', account_video_limit:'2', auto_refresh_seconds:'30', login_cover_url:'', storefront_notice:'Atención disponible todos los días'
  };
  for (const [k,v] of Object.entries(defaults)) if (data.settings[k] == null) data.settings[k] = v;
  data.products ||= []; data.faqs ||= []; data.payment_methods ||= []; data.orders ||= []; data.users ||= []; data.social_channels ||= []; data.recommendations ||= [];
  for (const p of data.products){ if(!Array.isArray(p.gallery))p.gallery=[]; p.created_at ||= now(); p.updated_at ||= now(); }
  for (const u of data.users){ u.updated_at ||= u.created_at || now(); }
  const collections={users:data.users,products:data.products,faqs:data.faqs,payment_methods:data.payment_methods,orders:data.orders,social_channels:data.social_channels,recommendations:data.recommendations};
  for(const [k,arr] of Object.entries(collections)) data.counters[k]=Math.max(Number(data.counters[k])||0,...arr.map(x=>Number(x.id)||0),0);
}

function persistLocal(){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  const tmp=DB_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(data,null,2));
  fs.renameSync(tmp,DB_FILE);
}


async function importBundledUploads(){
  if(!pool||!data)return 0;
  const targets=[];
  const add=(obj,key)=>{if(obj&&typeof obj[key]==='string'&&obj[key].startsWith('/uploads/'))targets.push([obj,key]);};
  for(const k of ['logo_url','login_music_url','login_cover_url','store_background_url','store_music_url'])add(data.settings,k);
  for(const p of data.products||[]){add(p,'image_url');for(const g of p.gallery||[])add(g,'url');}
  for(const x of data.payment_methods||[])add(x,'image_url');
  for(const x of data.social_channels||[])add(x,'image_url');
  let changed=0;
  for(const [obj,key] of targets){
    const rel=String(obj[key]).slice('/uploads/'.length);
    if(!/^[A-Za-z0-9._-]+$/.test(rel))continue;
    const file=path.join(UPLOADS,rel);if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
    const ext=path.extname(file).toLowerCase();
    const mt=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.m4a':'audio/mp4','.mp4':'video/mp4','.webm':'video/webm'})[ext];
    if(!mt)continue;
    const buf=fs.readFileSync(file),id=crypto.randomUUID();
    await pool.query('INSERT INTO baezshop_media(id,mime,bytes,size_bytes) VALUES($1,$2,$3,$4)',[id,mt,buf,buf.length]);
    obj[key]=`/media/${id}`;changed++;
  }
  return changed;
}

async function initPostgres(){
  const { Pool, Client } = require('pg');
  pool = new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
  await pool.query(`CREATE TABLE IF NOT EXISTS baezshop_state (
    id integer PRIMARY KEY,
    data jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS baezshop_media (
    id uuid PRIMARY KEY,
    mime text NOT NULL,
    bytes bytea NOT NULL,
    size_bytes integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  const seed = baseSeed();
  await pool.query('INSERT INTO baezshop_state(id,data,revision) VALUES(1,$1::jsonb,0) ON CONFLICT (id) DO NOTHING',[JSON.stringify(seed)]);
  const row = (await pool.query('SELECT data,revision FROM baezshop_state WHERE id=1')).rows[0];
  data = row.data; revision = Number(row.revision)||0; migrate();
  const importedUploads=await importBundledUploads();
  if(importedUploads)console.log(`Migrados ${importedUploads} archivos locales a PostgreSQL.`);
  // Persist migrations/defaults and any bundled upload conversion once.
  const migrated = await pool.query('UPDATE baezshop_state SET data=$1::jsonb,updated_at=now() WHERE id=1 RETURNING revision',[JSON.stringify(data)]);
  revision = Number(migrated.rows[0].revision)||revision;

  listener = new Client({ connectionString: DATABASE_URL });
  await listener.connect();
  await listener.query('LISTEN baezshop_changes');
  listener.on('notification', async msg=>{
    try{
      const payload=JSON.parse(msg.payload||'{}');
      if(payload.instance===INSTANCE_ID)return;
      const r=(await pool.query('SELECT data,revision FROM baezshop_state WHERE id=1')).rows[0];
      if(!r)return;
      data=r.data; revision=Number(r.revision)||revision; migrate();
      events.emit('change',{revision,reason:payload.reason||'external',at:payload.at||now(),external:true});
    }catch(e){ console.error('Realtime reload error:',e.message); }
  });
  listener.on('error',e=>console.error('Postgres LISTEN error:',e.message));
}

async function init(){
  fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(UPLOADS,{recursive:true});
  if(DATABASE_URL){
    await initPostgres();
    console.log('BAEZSHOP storage: PostgreSQL (persistent + realtime)');
  }else{
    data=baseSeed(); migrate(); persistLocal();
    console.log('BAEZSHOP storage: local JSON (development mode)');
  }
  return data;
}
function get(){ return data; }
function getRevision(){ return revision; }
function nextId(key){ data.counters[key]=(Number(data.counters[key])||0)+1; return data.counters[key]; }

async function save(reason='content'){
  saveChain = saveChain.then(async()=>{
    migrate();
    if(pool){
      const r=await pool.query('UPDATE baezshop_state SET data=$1::jsonb,revision=revision+1,updated_at=now() WHERE id=1 RETURNING revision',[JSON.stringify(data)]);
      revision=Number(r.rows[0].revision)||revision+1;
      const payload=JSON.stringify({revision,reason:String(reason).slice(0,80),at:now(),instance:INSTANCE_ID});
      await pool.query('SELECT pg_notify($1,$2)',['baezshop_changes',payload]);
    }else{
      persistLocal(); revision++;
    }
    events.emit('change',{revision,reason,at:now(),external:false});
    return revision;
  });
  return saveChain;
}

function onChange(fn){ events.on('change',fn); return ()=>events.off('change',fn); }
function mode(){ return pool?'postgres':'local'; }

function extForMime(mt){ return ({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','audio/mpeg':'.mp3','audio/wav':'.wav','audio/ogg':'.ogg','audio/mp4':'.m4a','video/mp4':'.mp4','video/webm':'.webm'})[mt]||'.bin'; }
async function putMedia(mime,buf){
  const id=crypto.randomUUID();
  if(pool){
    await pool.query('INSERT INTO baezshop_media(id,mime,bytes,size_bytes) VALUES($1,$2,$3,$4)',[id,mime,buf,buf.length]);
    return `/media/${id}`;
  }
  const name=`${id}${extForMime(mime)}`; fs.writeFileSync(path.join(UPLOADS,name),buf,{flag:'wx'}); return `/uploads/${name}`;
}
async function getMedia(id){
  if(!pool)return null;
  if(!/^[0-9a-f-]{36}$/i.test(String(id)))return null;
  const r=await pool.query('SELECT mime,bytes,size_bytes,created_at FROM baezshop_media WHERE id=$1',[id]);
  return r.rows[0]||null;
}

async function health(){
  if(!pool)return {ok:true,storage:'local',revision};
  const r=await pool.query('SELECT 1 AS ok');
  return {ok:r.rows[0]?.ok===1,storage:'postgres',revision};
}

async function close(){
  try{if(listener)await listener.end();}catch{}
  try{if(pool)await pool.end();}catch{}
}

module.exports={init,get,save,nextId,hashPassword,verifyPassword,getRevision,onChange,mode,putMedia,getMedia,health,close};
