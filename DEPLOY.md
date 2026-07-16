# Deploy de NutriChefIA

NutriChefIA corre como **un solo proceso** Express (API + frontend estático + `/uploads`) en el VPS Hetzner compartido con eskulclass / publipropiedades / medicaIA / nutriia / finanzasia.

> ⬜ **Estado: NO DESPLEGADO.** El subdominio `nutrichef.solucionesctec.com` ya existe en el panel DNS de `solucionesctec.com`; falta todo lo demás. Los prerequisitos bloqueantes están abajo — **el principal es que este proyecto todavía no es un repo git**.

## Datos de producción (previstos)

| Dato | Valor |
|------|-------|
| URL pública | `https://nutrichef.solucionesctec.com` |
| Servidor | Hetzner VPS `87.99.144.139` (compartido; hostname `eskulclass-server`) |
| Acceso SSH | `ssh -i C:\Users\user\.ssh\publipropiedades_deploy root@87.99.144.139` |
| Puerto backend | **`4005`** (4000=eskulclass, 4001=publipropiedades, 4002=medicaia, 4003=nutriia, 4004=finanzasia, 3000=pp-frontend, 5555/3001=calificaprof) |
| Ruta en el server | `/var/www/nutrichefia` |
| Proceso PM2 | `nutrichefia` |
| Repo | `github.com/abantostechnology2030/nutrichefia` (privado, rama `main`) — **por crear** |
| Base de datos | SQLite `nutrichefia.db` (raíz del proyecto, modo WAL) |
| Subidas | `uploads/` — comprobantes Yape + QR (persistente, gitignored) |
| SSL | Let's Encrypt vía certbot (renovación automática) |

> ⚠️ **Swap obligatorio:** el VPS necesita el `/swapfile` de 2GB (sin él `npm ci` muere por OOM, exit 137). Ya existe por los otros proyectos.
>
> ⚠️ **`better-sqlite3` compila al instalar.** Es una dependencia nativa: el `npm ci` del server necesita `build-essential` y `python3`. Ya están (medicaIA y NutriIA usan la misma dependencia), pero si el server se rehace desde cero, esto es lo primero que falla.

## ⚠️ Prerequisitos que faltan (antes de poder desplegar)

1. **Repositorio Git**: este proyecto **todavía no es un repo**. Hay que `git init`, crear el repo privado en GitHub y hacer push. El flujo de deploy clona desde GitHub.
2. **Revisar `.gitignore` antes del primer commit** — ver la sección "Trampas" abajo. `archivos/` está ignorado y ahí viven los **originales de marca**.
3. **Deploy key** del server para el repo privado (una por repo; las deploy keys **no** se reusan entre repos), + alias en `/root/.ssh/config`.
4. ~~**DNS**~~ ✅ **Listo.** El registro `A` `nutrichef.solucionesctec.com` → `87.99.144.139` ya resuelve (verificado 2026-07-15, misma IP que `finanzasia.solucionesctec.com`).
5. **Confirmar que el 4005 está libre** en el server (`ss -lntp | grep 4005`). La tabla de puertos de arriba viene de los `DEPLOY.md` de los otros proyectos, no de una inspección del server.
6. **Secrets de GitHub Actions** (Settings → Secrets and variables → Actions) si se usa el workflow — tabla abajo.

## Acceso del servidor a GitHub (repo privado)

Mismo patrón que NutriIA/finanzasIA — una deploy key dedicada por repo:

```bash
# En el server
ssh-keygen -t ed25519 -f /root/.ssh/nutrichefia_deploy -N "" -C "nutrichefia-deploy"
cat /root/.ssh/nutrichefia_deploy.pub   # → pegar como Deploy Key del repo (solo lectura)
```

Alias SSH en `/root/.ssh/config`:

```
Host github-nutrichefia
  HostName github.com
  User git
  IdentityFile ~/.ssh/nutrichefia_deploy
  IdentitiesOnly yes
```

URL de clonado: `git@github-nutrichefia:abantostechnology2030/nutrichefia.git`

## Variables de entorno en el servidor (`/var/www/nutrichefia/.env`)

El `.env` **NO se commitea** (está en `.gitignore`). Ver `.env.example` para la lista completa. En producción:

- `PORT=4005` — lo fija PM2 igualmente (`ecosystem.config.cjs`).
- `JWT_SECRET` — random de 96 hex (`openssl rand -hex 48`). **No reusar el local.**
- `AI_PROVIDER=gemini` — solo el fallback; en runtime manda `ai_modo` de la BD (panel admin).
- `GEMINI_API_KEY` / `GEMINI_MODEL=gemini-2.5-flash` — ver el aviso de crédito compartido abajo.
- `ANTHROPIC_BASE_URL=https://aiprimetech.io` — **gateway compartido** (no es la API directa de Anthropic).
- `ANTHROPIC_API_KEY` — la **misma key del gateway** que usa publipropiedades (`c:\app-publipropiedades\backend\.env`). Formato `sk-...`, no `sk-ant-...`.
- `ANTHROPIC_MODEL=claude-sonnet-4-6` — modelo soportado por el gateway.
- `YAPE_NUMERO`, `YAPE_TITULAR`, `PRECIO_PREMIUM` — **placeholders en el `.env.example`**, cambiar por los reales antes de cobrar.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOMBRE`, `ANALISIS_FREE=3`.

> ⚠️ **Credenciales admin:** el seed default es `admin@nutrichefia.pe` / `admin123`. **Cambiar la contraseña** tras el primer login, y los datos de Yape desde el panel admin.
>
> 🔥 **Crédito de Gemini compartido:** la `GEMINI_API_KEY` del `.env` local es **la misma de MedicaIA y NutriIA**. NutriChefIA es de lejos la más hambrienta de tokens de las tres (un menú = ~$0.029; regenerar, detallar y verificar suman aparte). **Sacar una key propia antes de abrir esto al público**, o el planificador se come el crédito de las otras dos apps. El panel admin (`/api/admin/resumen`) ya muestra crédito/restante por proveedor con alertas al 20%.

## Puesta en marcha desde cero

```bash
# 1. En el server
cd /var/www
git clone git@github-nutrichefia:abantostechnology2030/nutrichefia.git nutrichefia
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

## Trampas de este proyecto (leer antes del primer deploy)

- **`archivos/` está en `.gitignore`** (heredado de NutriIA) y ahí viven `logotipo.png` y `favicon.png`, los **únicos originales de la marca**. Si haces el primer commit tal cual, los originales **no se versionan** y existen solo en esta máquina. Decidir antes de `git init`: sacarlos del ignore, o moverlos a `public/img/` al aplicar el rebranding (ver "Rebranding pendiente" en `CLAUDE.md`).
- **El rebranding sigue pendiente.** Lo que se despliegue hoy sale con la **paleta y el logo de NutriIA** (carmín/coral), no con la identidad verde+naranja de NutriChefIA. Funcionalmente da igual, pero es una app pública con la marca equivocada.
- **`uploads/` es persistente y gitignored.** Guarda los comprobantes de Yape y el QR de pago (`config.yape_qr_path` apunta ahí). Un `rm -rf uploads` rompe los pagos y borra evidencia de transacciones. El deploy solo hace `mkdir -p`.
- **La BD está en modo WAL.** Respaldar con `cp nutrichefia.db` a secas deja fuera lo que aún vive en el `-wal`. Usar `sqlite3 nutrichefia.db ".backup 'destino.db'"` (es lo que hace el workflow).
- **`client_max_body_size` = 20M, no 12M.** El escáner sube **dos** imágenes en un mismo multipart (`ingredientes` + `nombre`), 8MB cada una por el límite de multer → el cuerpo puede llegar a ~16MB. Los 12M que usa NutriIA (una sola imagen) darían **413** antes de que multer pudiera responder.
- **`proxy_read_timeout` = 180s.** Generar el menú (21 platos) es una llamada a la IA de ~60s medidos; el default de nginx (60s) queda al filo y produce 504 fantasma con el menú a medio generar.
- **El `deploy.yml` de NutriIA está roto** — es un copy-paste de MedicaIA sin terminar: job "Deploy MedicaIA", `concurrency: deploy-medicaia`, backup a `~/backups/medicaia` y **health check al puerto 4002** (MedicaIA), no al 4003 de NutriIA. Es decir, **da verde aunque NutriIA esté caída**. El de aquí ya está corregido; si algún día tocas el de NutriIA, arréglalo también.
- **Estado del producto: fases 1-3 hechas, fase 4 a medias.** Lo que se despliegue hoy no tiene pasos de preparación (el modal avisa), ni verificación de platos propuestos, ni lista de faltantes/PDF. Ver `CLAUDE.md` → "POR DÓNDE SEGUIR".
