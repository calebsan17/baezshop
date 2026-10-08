# BAEZSHOP V3 · Railway + PostgreSQL + Tiempo Real

Esta versión está preparada para que los cambios hechos desde el panel administrativo se publiquen para todos los clientes conectados sin depender del disco local del servidor.

## Qué cambia en V3

- Persistencia real con PostgreSQL cuando existe `DATABASE_URL`.
- Los productos, precios, cuentas, pedidos, recomendaciones, preguntas, pagos, redes, configuración y usuarios quedan guardados en PostgreSQL.
- Las imágenes, audios y videos subidos desde el panel también se guardan de forma persistente en PostgreSQL y se sirven desde `/media/...`.
- Publicación en tiempo real mediante Server-Sent Events (SSE).
- PostgreSQL `LISTEN/NOTIFY` sincroniza cambios incluso si en el futuro hay más de una instancia.
- Inicio, catálogo y producto se actualizan sin que el visitante tenga que recargar manualmente.
- El panel muestra el estado `Publicación en vivo` y confirma cuando un cambio ya fue publicado.
- Endpoint `/health` para Railway.
- Si ejecutas el proyecto sin PostgreSQL, sigue funcionando en modo local con `data/store.json` para desarrollo.

## Ejecutar localmente

1. Instala Node.js 20 o superior.
2. En la carpeta del proyecto:

```bash
npm install
npm start
```

3. Abre:

```text
http://localhost:3000
http://localhost:3000/login.html
```

Sin `DATABASE_URL` se usa almacenamiento local. Esto es solo para desarrollo.

## Publicar desde GitHub en Railway

### 1. Actualiza tu repositorio `baezshop`

Copia esta versión encima de tu proyecto actual. No necesitas copiar `node_modules`.

En VS Code:

```bash
git add .
git commit -m "BAEZSHOP V3 Railway tiempo real"
git push origin master
```

Si tu rama es `main`, usa `git push origin main`.

### 2. Crea el proyecto en Railway

En Railway:

1. `New Project`
2. `Deploy from GitHub repo`
3. Selecciona `baezshop`

Railway detectará `package.json` y usará `npm start`. En servicios nuevos no necesitas `railway.json`; la configuración de deploy se hace desde el panel de Railway.

### 3. Añade PostgreSQL

Dentro del mismo proyecto Railway:

1. `Create` o `+ New`
2. `Database`
3. `PostgreSQL`

Espera a que la base de datos termine de desplegarse.

### 4. Conecta la app con PostgreSQL

En el servicio web de `baezshop` abre `Variables` y agrega:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
OWNER_USERNAME=dcbaez2026
OWNER_DISPLAY_NAME=Jefe BAEZSHOP
OWNER_PASSWORD=TU_CONTRASENA_NUEVA_Y_SEGURA
```

El nombre `Postgres` debe coincidir con el nombre de tu servicio PostgreSQL en Railway.

No pongas una variable `PORT` manualmente: Railway la inyecta automáticamente.

### 5. Configura el healthcheck y redeploy

En el servicio web abre `Settings` y configura `Healthcheck Path` como `/health`. Después aplica las variables y despliega nuevamente.

En los logs debe aparecer algo parecido a:

```text
BAEZSHOP storage: PostgreSQL (persistent + realtime)
BAEZSHOP V3 listo en http://0.0.0.0:XXXX
Persistencia: postgres · Tiempo real: SSE + PostgreSQL NOTIFY
```

### 6. Genera el dominio público

En el servicio web:

1. `Settings`
2. `Networking`
3. `Generate Domain`

Usa ese enlace para clientes.

## Comprobar que está correctamente configurado

Visita:

```text
https://TU-DOMINIO/health
```

Debe responder algo parecido a:

```json
{
  "status": "ok",
  "storage": "postgres",
  "revision": 5
}
```

Si aparece `storage: local`, la app funciona pero todavía no está usando PostgreSQL persistente.

## Prueba de tiempo real

1. Abre la tienda en un celular.
2. Abre el panel en tu PC.
3. Edita el precio o nombre de un producto.
4. Presiona Guardar.
5. El panel mostrará `Publicado para todos`.
6. El celular debe actualizar el contenido automáticamente en pocos instantes.

También funciona para:

- productos y stock;
- canales y estado EN VIVO;
- recomendaciones aprobadas;
- preguntas frecuentes;
- apariencia y fondo;
- música;
- métodos de pago;
- configuración general.

## Multimedia persistente

Con PostgreSQL, los archivos subidos desde el panel se guardan en la tabla `baezshop_media`. Esto evita que desaparezcan después de un deploy de Railway.

Para una tienda con muchísimos videos grandes, más adelante conviene mover multimedia a Railway Storage Buckets u otro almacenamiento S3. Para una tienda pequeña/mediana, esta versión funciona sin tener que configurar otro servicio.

## Seguridad

Antes de publicar:

- usa una contraseña nueva en `OWNER_PASSWORD`;
- no subas `.env` a GitHub;
- no publiques credenciales de PostgreSQL;
- mantén `.gitignore` como viene en este proyecto;
- usa HTTPS del dominio generado por Railway.

## Archivos principales

```text
server.js                 API, autenticación, CRUD, SSE y multimedia
db.js                     PostgreSQL/local, persistencia y LISTEN/NOTIFY
seed.json                 datos iniciales si la base está vacía
public/js/site.js         conexión en tiempo real del cliente
public/js/admin.js        panel y estado de publicación
public/js/home.js         inicio en tiempo real
public/js/catalog.js      catálogo en tiempo real
public/js/product.js      producto en tiempo real
```

## Pruebas

```bash
npm test
```

Debe terminar con:

```text
SMOKE TEST OK
```


## Tema celeste
Esta edición usa celeste/cian como color principal en la tienda, panel administrativo, login, voucher y logotipo, reemplazando el tema amarillo/naranja anterior.
