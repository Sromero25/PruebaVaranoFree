# Desplegar Varano (frontend en Vercel + API + MySQL)

El frontend es estático (Vite) y ya vive en Vercel. La API es un servidor
Node/Express que necesita una URL pública y una base MySQL accesible desde
internet. Sin eso, el login no puede funcionar en Vercel.

Hay dos caminos. El **A** es gratis; el **B** es el más rápido de montar.

---

## Opción A (recomendada): Render gratis + MySQL de Aiven gratis

### 1. Crear la base MySQL en Aiven

1. Entra a <https://aiven.io> y crea una cuenta.
2. **Create service → MySQL → Free plan**.
3. Cuando termine, abre el servicio y copia:
   - **Host** (algo como `mysql-xxxx.aivencloud.com`)
   - **Port** (no es 3306, usa el que te dé Aiven)
   - **User** (`avnadmin`)
   - **Password**
   - **Database** (`defaultdb`)
4. Aiven exige TLS: por eso usaremos `DB_SSL=true`.

> Si Aiven te pide tarjeta o no tiene plan gratis disponible, una alternativa es
> **TiDB Cloud Serverless** (<https://tidbcloud.com>), que es compatible con
> MySQL y tiene plan gratis. Usa `DB_SSL=true` y el puerto que te indique.

### 2. Crear la API en Render

1. Entra a <https://render.com> y conecta tu cuenta de GitHub.
2. **New → Blueprint** y elige el repositorio `Sromero25/PruebaVaranoFree`.
   Render leerá el archivo `render.yaml` de la raíz.
3. Captura las variables que te pida:
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` con los datos de Aiven.
   - `ADMIN_INVITE_CODE` puede quedar vacío.
4. Deploy. Al arrancar, el servicio ejecuta la migración sola
   (`npm run start:prod`).
5. Comprueba que responde:
   `https://<tu-servicio>.onrender.com/api/health`

> El plan gratis de Render "duerme" el servicio tras unos minutos sin uso.
> La primera petición puede tardar 30–60 segundos. Es normal.

### 3. Conectar Vercel con la API

En el proyecto de Vercel: **Settings → Environment Variables**

```
VITE_API_URL = https://<tu-servicio>.onrender.com/api
```

Después **Deployments → Redeploy** para que el build lo tome.

También puedes pedirme que lo deje en un `.env.production` del repositorio y
hacer push; el resultado es el mismo.

### 4. Primer acceso

Al abrir la app, como la base está vacía, aparecerá la pantalla para crear el
administrador. Crea tu cuenta y listo. Los demás usuarios se registran desde
"Crear cuenta" o los crea el administrador desde el panel.

---

## Opción B (más rápida): Railway con MySQL incluido

1. Entra a <https://railway.app> y crea un proyecto desde GitHub con este repo.
2. En el servicio, configura **Root Directory = `backend`**.
3. **New → Database → MySQL**. Railway crea la base y expone `MYSQLHOST`,
   `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` y `MYSQL_URL`.
   La API ya sabe leer esas variables.
4. En el servicio web, agrega `CORS_ORIGIN=https://*.vercel.app,http://localhost:5173`
   y `NODE_ENV=production`.
5. Railway ejecuta `npm run start:prod`, que migra y arranca.
6. Copia la URL pública del servicio y configúrala en Vercel como
   `VITE_API_URL=https://<tu-servicio>.up.railway.app/api`.

Railway ya no tiene plan gratis permanente; da crédito de prueba y luego cobra
unos $5 al mes. Para una prueba corta funciona muy bien.

---

## Si prefieres no contratar nada todavía

Puedes probar todo en tu equipo:

```powershell
# Terminal 1 - API
cd C:\Users\saulo\varano-backend
npm run migrate
npm run dev

# Terminal 2 - frontend
cd C:\Users\saulo\Varano
npx vite --host 127.0.0.1 --port 5173
```

Abre <http://127.0.0.1:5173>. El backend local ya está migrado y funcionando.

---

## Notas de seguridad para producción

- Cambia la contraseña de MySQL y no la subas al repositorio.
- Define `ADMIN_INVITE_CODE` solo si quieres permitir autorregistro de admins;
  si no, déjalo vacío y crea los admins desde el panel.
- Restringe `CORS_ORIGIN` a tu dominio real cuando termines las pruebas
  (el comodín `https://*.vercel.app` es solo para los previews).
- El plan gratis de Render duerme el servicio; para uso diario conviene un plan
  pago o un servicio siempre activo.
