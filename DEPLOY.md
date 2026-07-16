# Deploy de NutriChefIA

NutriChefIA corre como **un solo proceso** Express (API + frontend estático + `/uploads`) en el VPS Hetzner compartido con eskulclass / publipropiedades / medicaIA / nutriia / finanzasia.

> ✅ **Estado: EN PRODUCCIÓN** desde 2026-07-16 → **https://nutrichef.solucionesctec.com**
>
> Verificado de punta a punta contra producción: registro → hogar → despensa → **generar un plato con IA** (3,5 s) → **verificar un plato con alérgeno** (5,7 s, avisó correctamente). SSL de Let's Encrypt con renovación automática (`certbot.timer` activo).

## Datos de producción

| Dato | Valor |
|------|-------|
| URL pública | `https://nutrichef.solucionesctec.com` |
| Servidor | Hetzner VPS `87.99.144.139` (compartido; hostname `eskulclass-server`) |
| Acceso SSH | `ssh -i C:\Users\user\.ssh\publipropiedades_deploy root@87.99.144.139` |
| Puerto backend | **`4005`** (4000=eskulclass, 4001=publipropiedades, 4002=medicaia, 4003=nutriia, 4004=finanzasia, 3000=pp-frontend, 5555/3001=calificaprof) |
| Ruta en el server | `/var/www/nutrichefia` |
| Proceso PM2 | `nutrichefia` |
| Repo | `github.com/abantostechnology2030/nutrichef` (privado, rama `main`) |
| Base de datos | SQLite `nutrichefia.db` (raíz del proyecto, modo WAL) |
| Subidas | `uploads/` — comprobantes Yape + QR (persistente, gitignored) |
| SSL | Let's Encrypt vía certbot (renovación automática) |

> ⚠️ **Swap obligatorio:** el VPS necesita el `/swapfile` de 2GB (sin él `npm ci` muere por OOM, exit 137). Ya existe por los otros proyectos.
>
> ⚠️ **`better-sqlite3` compila al instalar.** Es una dependencia nativa: el `npm ci` del server necesita `build-essential` y `python3`. Ya están (medicaIA y NutriIA usan la misma dependencia), pero si el server se rehace desde cero, esto es lo primero que falla.

## ✅ Prerequisitos — todos resueltos (2026-07-16)

1. ~~Repositorio Git~~ → `github.com/abantostechnology2030/nutrichef`, rama `main`.
2. ~~`.gitignore`~~ → **`archivos/` SÍ se versiona** (los originales de marca existían solo en un disco). El `.env`, la BD y `uploads/*` siguen fuera — verificado con `git check-ignore` antes del primer commit.
3. ~~Deploy keys~~ → dos, ambas en *Settings → Deploy keys* del repo:
   - **`push-local`** (con *write access*): la máquina de desarrollo empuja con `~/.ssh/nutrichef_push`. El repo local lo usa vía `git config core.sshCommand` — **local, no global**.
   - **`vps-eskulclass-server`** (**solo lectura**): el servidor clona con `/root/.ssh/nutrichef_deploy`. Solo necesita leer; darle escritura sería regalarle permisos que no usa.
4. ~~DNS~~ → `A nutrichef.solucionesctec.com` → `87.99.144.139`.
5. ~~Puerto 4005 libre~~ → confirmado por inspección (`ss -lntp`), no por suposición.
6. **Secrets de GitHub Actions** — ⬜ pendiente, solo si se quiere el deploy por workflow. Hoy el redeploy es manual por SSH (abajo).

## Acceso del servidor a GitHub

Alias SSH en `/root/.ssh/config` (las deploy keys son **por repo**, así que cada proyecto necesita el suyo):

```
Host github-nutrichef
  HostName github.com
  User git
  IdentityFile ~/.ssh/nutrichef_deploy
  IdentitiesOnly yes
```

URL de clonado: `git@github-nutrichef:abantostechnology2030/nutrichef.git`

## Variables de entorno en el servidor (`/var/www/nutrichefia/.env`)

El `.env` **NO se commitea** (está en `.gitignore`). Ver `.env.example` para la lista completa. En producción:

- `PORT=4005` — lo fija PM2 igualmente (`ecosystem.config.cjs`).
- `JWT_SECRET` — random de 96 hex (`openssl rand -hex 48`). **No reusar el local.**
- `AI_PROVIDER=gemini` — solo el fallback si la BD no tiene `ai_modo`; en runtime manda la `config` de la BD (panel admin).
- `GEMINI_API_KEY` / `GEMINI_MODEL=gemini-2.5-flash` — ver el aviso de crédito compartido abajo.
- `ANTHROPIC_BASE_URL=https://aiprimetech.io` — **gateway compartido** (no es la API directa de Anthropic).
- `ANTHROPIC_API_KEY` — la **misma key del gateway** que usa publipropiedades (`c:\app-publipropiedades\backend\.env`). Formato `sk-...`, no `sk-ant-...`.
- `ANTHROPIC_MODEL=claude-sonnet-5` — ⚠️ **el "grupo" de la key en el panel del gateway (Claude Default 0.85x / Fast 1.1x / Max 1.3x) es un MULTIPLICADOR DE PRECIO, no un modelo.** Los tres grupos sirven los mismos: `claude-opus-4-8`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-fable-5`. El modelo se elige **aquí**, no allá. Un modelo inventado ("claude max 1.3") devuelve un 400 disfrazado de *"Your conversation is too long"*.
- `YAPE_NUMERO=976901977`, `YAPE_TITULAR`, `PRECIO_PREMIUM=19.90` — **el titular sigue siendo un placeholder**; se cambia desde el panel admin (vive en la tabla `config`, no en el `.env`).
- `ADMIN_EMAIL=admin@nutrichefia.pe`, `ADMIN_PASSWORD`, `ADMIN_NOMBRE`, `ANALISIS_FREE=3`.

> ⚠️ **Credenciales admin:** el seed default es `admin@nutrichefia.pe` / `admin123`. **Cambiar la contraseña** tras el primer login (panel admin → Config → "Cambiar mi contraseña", o `node scripts/cambiar-password-admin.js "NuevaClave"` en el server), y los datos de Yape desde el panel admin. **Sigue sin cambiarse en producción.**
>
> 🔥 **Crédito de Gemini compartido:** la `GEMINI_API_KEY` del `.env` local es **la misma de MedicaIA y NutriIA**. NutriChefIA es de lejos la más hambrienta de tokens de las tres (un menú = ~$0.029; regenerar, detallar y verificar suman aparte). **Sacar una key propia antes de abrir esto al público**, o el planificador se come el crédito de las otras dos apps. El panel admin (`/api/admin/resumen`) ya muestra crédito/restante por proveedor con alertas al 20%.

## Puesta en marcha desde cero

```bash
# 1. En el server
cd /var/www
git clone git@github-nutrichef:abantostechnology2030/nutrichef.git nutrichefia
cd nutrichefia

cp .env.example .env && nano .env      # completar valores reales (ver arriba)
mkdir -p uploads
npm ci --no-audit --no-fund
npm run seed                           # crea el admin (idempotente)

pm2 start ecosystem.config.cjs && pm2 save
curl -s http://localhost:4005/api/health   # → {"ok":true,"servicio":"NutriChefIA",...}

# 2. Nginx + SSL
sudo cp nginx.nutrichef.solucionesctec.com.conf /etc/nginx/sites-available/nutrichef.solucionesctec.com
sudo ln -s /etc/nginx/sites-available/nutrichef.solucionesctec.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d nutrichef.solucionesctec.com --redirect
```

> El archivo `nginx.nutrichef.solucionesctec.com.conf` del repo es una **referencia**: certbot reescribe la config viva al agregar el bloque SSL.

## Cómo redesplegar (manual por SSH)

```bash
ssh -i C:\Users\user\.ssh\publipropiedades_deploy root@87.99.144.139
cd /var/www/nutrichefia
git fetch origin && git reset --hard origin/main
npm ci --no-audit --no-fund
npm run seed || true        # idempotente (no recrea el admin si ya existe)
pm2 restart nutrichefia --update-env
curl -s http://localhost:4005/api/health   # debe responder {"ok":true,...}
```

O por **GitHub Actions**: pestaña *Actions → Deploy to Hetzner → Run workflow* (usa `.github/workflows/deploy.yml`, manual con `workflow_dispatch`). Requiere estos Secrets:

| Secret | Valor |
|--------|-------|
| `SSH_HOST` | `87.99.144.139` |
| `SSH_USER` | `root` |
| `SSH_PORT` | `22` |
| `SSH_PRIVATE_KEY` | contenido completo de `C:\Users\user\.ssh\publipropiedades_deploy` (con líneas BEGIN/END, respetando saltos) |
| `PROJECT_PATH` | `/var/www/nutrichefia` |
| `PM2_NAME` | `nutrichefia` |

El workflow respalda la BD (10 copias rodantes en `~/backups/nutrichefia`), hace pull, `npm ci`, seed, restart y **health check contra el 4005**.

## Lo que pasó el día del despliegue (2026-07-16)

- **NO recortes la conf de nginx del repo con `sed` para quitarle el bloque SSL.** `sed '/listen 443 ssl;/,$d'` borra desde esa línea al final y **deja huérfano el `server {`** del bloque 443 → `unexpected end of file, expecting "}"` y nginx no carga. Escribe la conf de :80 **entera** y deja que certbot agregue el :443. (Nginx rechazó la conf rota y **siguió con la anterior**, así que las otras 6 apps del VPS no se cayeron: el `nginx -t` hizo su trabajo. Aun así, no repitas el atajo.)
- **El DNS de `solucionesctec.com` se cayó a mitad del despliegue** y certbot falló con *"DNS problem: query timed out"*. Diagnóstico: la **zona entera** daba SERVFAIL (raíz, `www` y `nutrichef`), mientras `finanzasia` seguía resolviendo **desde caché** y `eskulclass.com` —mismo servidor— iba perfecto. Si certbot falla por DNS: compara la **raíz** de la zona contra otro dominio del mismo VPS antes de tocar nada del servidor. Se resolvió solo desde el lado del proveedor de DNS.
- **Un navegador NO sirve para diagnosticar DNS.** Chrome/Edge usan DNS-over-HTTPS y se saltan el resolver del sistema: el dominio "funcionaba" en el navegador mientras `Resolve-DnsName`/`dig` daban SERVFAIL en la misma máquina. Usa `dig`/`resolvectl` desde el VPS, que es quien tiene que resolver.

## Trampas de este proyecto (leer antes del primer deploy)

- **`archivos/` está en `.gitignore`** (heredado de NutriIA) y ahí viven `logotipo.png` y `favicon.png`, los **únicos originales de la marca**. Si haces el primer commit tal cual, los originales **no se versionan** y existen solo en esta máquina. Decidir antes de `git init`: sacarlos del ignore, o moverlos a `public/img/` al aplicar el rebranding (ver "Rebranding pendiente" en `CLAUDE.md`).
- ~~**El rebranding sigue pendiente.**~~ Hecho (2026-07-15): paleta verde+naranja muestreada del logo, logo/favicon/iconos propios y mascota flotante propia. Solo queda el chef del semáforo del escáner (ver `CLAUDE.md` → "Rebranding").
- **`uploads/` es persistente y gitignored.** Guarda los comprobantes de Yape y el QR de pago (`config.yape_qr_path` apunta ahí). Un `rm -rf uploads` rompe los pagos y borra evidencia de transacciones. El deploy solo hace `mkdir -p`.
- **La BD está en modo WAL.** Respaldar con `cp nutrichefia.db` a secas deja fuera lo que aún vive en el `-wal`. Usar `sqlite3 nutrichefia.db ".backup 'destino.db'"` (es lo que hace el workflow).
- **`client_max_body_size` = 20M, no 12M.** El escáner sube **dos** imágenes en un mismo multipart (`ingredientes` + `nombre`), 8MB cada una por el límite de multer → el cuerpo puede llegar a ~16MB. Los 12M que usa NutriIA (una sola imagen) darían **413** antes de que multer pudiera responder.
- **`proxy_read_timeout` = 180s.** Generar el menú (21 platos) es una llamada a la IA de ~60s medidos; el default de nginx (60s) queda al filo y produce 504 fantasma con el menú a medio generar.
- **El `deploy.yml` de NutriIA está roto** — es un copy-paste de MedicaIA sin terminar: job "Deploy MedicaIA", `concurrency: deploy-medicaia`, backup a `~/backups/medicaia` y **health check al puerto 4002** (MedicaIA), no al 4003 de NutriIA. Es decir, **da verde aunque NutriIA esté caída**. El de aquí ya está corregido; si algún día tocas el de NutriIA, arréglalo también.
- **Estado del producto: fases 1-4 hechas.** Falta la fase 5 (lista de faltantes + PDF). La **mascota flotante propia** ya está (chef distinto a la derecha de home/plan/despensa/platos, 2026-07-16); falta solo el chef del **semáforo del escáner** (3 versiones). Ver `CLAUDE.md` → "POR DÓNDE SEGUIR" y "Rebranding".
- **⚠️ Producción NO usa la misma IA que tu local.** La tabla `config` del server es nueva y quedó en **`ai_modo='ambos'` con `ai_prioridad='gemini'`** — al revés que el local (prioridad `claude`). Por eso en producción genera en **~3,5 s y cuesta ~$0.036/semana**, contra ~30 s y ~$0.14 con Claude (sonnet-5 en precio de lanzamiento; sube a ~$0.21 el 1-sep-2026). Es lo que conviene; si alguien cambia la prioridad desde el admin, el costo se multiplica por ~4 (y por ~10 si lo pone en opus-4-8). El desglose por proveedor está en `GET /api/admin/resumen`.
- **La `GEMINI_API_KEY` de producción es la MISMA de MedicaIA y NutriIA** (verificado: bytes idénticos). Las tres apps comparten crédito y ésta es la más hambrienta. Sacar una key propia antes de tener usuarios reales.
