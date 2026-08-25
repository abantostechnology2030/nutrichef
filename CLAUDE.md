# CLAUDE.md

Guía para trabajar en **NutriChefIA**. Lee esto antes de tocar el código.

## Qué es

App web que **planifica las comidas de una familia** (desayuno / almuerzo / cena, de lunes a domingo) con IA, para el mercado peruano. El usuario configura su **hogar** (integrantes, condiciones médicas, alergias, dieta, región), llena su **despensa** (stock de productos) y la registra como **compra de un periodo** (N semanas), y la IA **propone los platos** usando los ingredientes con los que ya cuenta, adaptando recetas de su región al número de comensales y a sus restricciones de salud. Incluye además un **escáner de productos** (foto o nombre → semáforo verde/ámbar/rojo). Modelo **freemium** con pagos manuales por **Yape** aprobados por un admin.

> 🥗 La información generada es orientativa y no reemplaza la consulta con un nutricionista o profesional de salud. Mantener este disclaimer visible en el frontend.

> **Origen:** fork de **NutriIA** (`C:\app-nutriia`), que a su vez venía de MedicaIA. Se reutilizó su arquitectura (freemium, planes, Yape, IA configurable, panel admin) y el andamio de su módulo *Loncheras* (navegación semanal por fecha del lunes) como base del calendario de comidas. **Loncheras y las recetas escolares NO existen aquí**: fueron solo código de partida.

## La inversión conceptual (lo más importante de entender)

En NutriIA la IA era **pasiva**: el usuario armaba una combinación de alimentos y la IA solo la evaluaba; la lista de compras se derivaba del plan.

En NutriChefIA el flujo se invierte y hay **dos direcciones**:

1. **Generar** — `despensa + hogar → IA → platos`. La compra es la *entrada*, no la salida.
2. **Verificar** — `plato propuesto por el usuario → IA → ¿alcanza la despensa?`. El usuario escribe "ají de gallina" y la IA dice qué tiene y qué le falta.

Los faltantes de ambas direcciones se consolidan en **una sola lista de compras**.

## Stack

- **Backend:** Node.js + Express (CommonJS, `"type": "commonjs"`)
- **BD:** SQLite vía `better-sqlite3` — archivo `nutrichefia.db` (WAL, `foreign_keys = ON`). API **síncrona** (sin `await` en las queries).
- **IA:** proveedor intercambiable (`gemini` | `claude` | `ambos`) configurable desde el admin. Gemini vía `@google/genai`; Claude vía `@anthropic-ai/sdk` (gateway `aiprimetech.io`). Texto y visión multi-imagen.
- **Auth:** JWT (`jsonwebtoken`, 7 días) + `bcryptjs`.
- **Uploads:** `multer` (imágenes a memoria para IA; comprobantes y QR de Yape a disco en `uploads/`).
- **Frontend:** HTML + CSS + JS plano servido por el mismo Express desde `public/`. Sin framework, sin build step.
- **Diseño:** sistema centralizado en `public/css/style.css` (variables CSS = tokens, al inicio del archivo). Fuentes Quicksand (títulos) + Plus Jakarta Sans (cuerpo). Sin Tailwind. La paleta es **verde + naranja muestreada del logotipo** (`#124819` / `#ea6b02` / `#538e18`) — ver "Rebranding" en Deuda. El **semáforo del escáner** (`sem-*`) tiene su propia paleta verde/ámbar/rojo, independiente de la marca: no tocarla al repaletear.

## Arquitectura — punto clave

**Un solo servidor Express sirve la API (`/api/*`) Y el frontend estático (`public/`).** No hay proceso separado de frontend. `npm start` levanta todo en `http://localhost:3002` (3002 para no chocar con MedicaIA en 3000 ni NutriIA en 3001).

## Comandos

```bash
npm install        # dependencias
npm run seed       # crea el admin inicial (idempotente)
npm start          # node src/server.js
npm run dev        # node --watch src/server.js  <- usar este al desarrollar

npm run smoke        # smoke test de hogar + despensa (gratis, ~10s, servidor arriba)
npm run smoke:inicio # dashboard + barra inferior + perfil (gratis, ~10s)
npm run movil        # revisa el LAYOUT en movil con Chrome real + capturas (gratis, ~30s)
npm run smoke:platos # smoke test de la biblioteca + el calendario sin IA (gratis, ~20s)
npm run smoke:compras # "Mis compras": lista, subtotales por pasillo (gratis, ~10s)
npm run smoke:analisis # analisis de consumo: la aritmetica del periodo (gratis, ~10s)
npm run smoke:plan   # calendario + generar + verificar con IA REAL (4 llamadas, ~60s)
                     #   -> $0.012 con gemini | $0.047 con claude  (segun ai_prioridad!)
```

No hay linter ni build. Los tests son **smoke tests de extremo a extremo** (jsdom contra
el servidor real) — ver `pruebas/README.md`.

> ⚠️ `npm start` **no recarga** al editar. Si tocas `src/`, usa `npm run dev` o reinicia:
> más de una vez me llegó un 404 de una ruta recién creada por probar contra el proceso viejo.
>
> `dev` vigila **solo `src/`** (`--watch-path=src`) a propósito. Con `--watch` a secas
> entraba en un **bucle infinito de reinicios** y nunca llegaba a escuchar el puerto: el
> servidor escribe `nutrichefia.db` (+ los archivos WAL) al arrancar, el watcher lo
> detectaba y reiniciaba, y vuelta a empezar. No le quites el `--watch-path`.

## Estado — ✅ EN PRODUCCIÓN

**https://nutrichefia.solucionesctec.com** desde 2026-07-16 (dominio cambiado el 2026-08-10; antes `nutrichef.…`, ver `DEPLOY.md`). Local: `http://localhost:3002`. Admin: `admin@nutrichefia.pe` — la contraseña **en local** es `admin123`; **en producción ya se cambió**.

> ⚠️ **Local y producción corren con `ai_modo='gemini'`** (verificado en las dos BD el 2026-07-27): ~3,5 s por plato, ~$0.038–0.045/semana. **Sin fallback**: si Gemini falla, la llamada devuelve 502 en vez de caer a Claude. Con Claude de prioridad son ~30 s y ~$0.14/semana (sonnet-5 en precio de lanzamiento), unas 4x. La verdad vive en la tabla `config` de **cada** BD (`SELECT * FROM config WHERE clave LIKE 'ai_%'`), no en este archivo ni en el `.env`: si comparas latencias o costos entre entornos, mírala primero.

| Fase | Qué | Estado |
|---|---|---|
| 1 | Base: esquema limpio, auth, freemium, Yape, admin, escáner | ✅ **hecha** |
| 2 | Hogar + Despensa (config previa, sin IA) | ✅ **hecha** |
| 3 | Generador IA **por día** + calendario 7×3 + regenerar día/plato | ✅ **hecha** |
| 4 | Detalle del plato (pasos) + platos manuales/biblioteca + **verificar platos propuestos** | ✅ **hecha** |
| 5 | **Compra por periodo** + lista de faltantes consolidada + PDF | ✅ **hecha** |
| 6 | Admin: catálogo de ingredientes + medidor con generaciones | 🟡 backend listo, falta pulir UI |

**Funciona hoy, de punta a punta:** registro/login → configurar hogar → registrar la
compra → **generar el calendario día por día con IA** → navegar semanas, cambiar un plato,
marcar cocinado, copiar una semana, ver el detalle de cada plato → **curar su biblioteca en
"Mis platos"** (crear/editar/borrar recetas propias). Más el escáner de productos, el
paywall Yape y el panel admin.

Y **las tres vías** para llenar una casilla: *"✨ Proponer"* (la IA elige con tu despensa),
*"✍️ Ya sé qué cocinar"* (tú eliges y la IA verifica si te alcanza y si le conviene a tu
hogar) y *"📋 Mis platos"*. Cada plato trae su **receta**, su **aporte nutricional** y, si lo
propusiste tú, su **cobertura** con advertencias médicas.

**Datos de prueba en la BD local:** `fam@test.pe` / `prueba123` — "Casa Abanto" (sierra/Cusco), 4 integrantes con condiciones reales (diabetes, hipertensión, intolerancia a la lactosa) y alergias (maní, mariscos), 16 ingredientes en despensa y una semana con menú generado. Sirve para probar el planificador contra un hogar realista. **Ojo:** cualquier basura que quede en la despensa la IA la tomará como real y generará platos alrededor de ella.

## Estructura

```
src/
  server.js              # arranque Express; monta rutas y estaticos
  db.js                  # schema SQLite COMPLETO + helpers (config, usuarioPublico, fechas, constantes)
  seed.js                # crea la cuenta admin (npm run seed)
  middleware/
    auth.js              # requiereAuth (JWT->req.usuario fresco), requiereAdmin, firmarToken
    freemium.js          # candadoFreemium + descontarAnalisis: el candado del ESCANER
    planificador.js      # requierePlanificador (gate del plan) + requiereHogar (onboarding)
  routes/
    auth.routes.js       # /registro, /login, /yo, /perfil (PATCH), /password (POST)
    inicio.routes.js     # dashboard: comidas de hoy + estadisticas de uso (sin IA)
    analisis.routes.js   # escaner: /texto (cache-first), /imagen (2 fotos), /historial, DELETE
    hogar.routes.js      # hogar + CRUD de integrantes + interruptor de la despensa
    despensa.routes.js   # inventario (alta inmediata) + /compra (snapshot por periodo) + /compras (historial, con borrado)
    compras.routes.js    # "Mis compras": precios, presupuesto, gasto e historico
    plan.routes.js       # calendario 7x3 + /generar (POR DIA) + /verificar + /detallar + /copiar + /faltantes y /necesidad
    nutricion.routes.js  # ANALISIS de consumo de un rango (resumen sin IA + informe con IA)
    platos.routes.js     # biblioteca: CRUD de platos manuales + guardar/quitar (tope platos_max)
    pagos.routes.js      # info del paywall (incl. yape_qr) + comprobante Yape + /historial
    soporte.routes.js    # mensajes de contacto
    admin.routes.js      # planes, pagos, usuarios, config (motor IA), QR Yape, catalogo de ingredientes
  services/
    ai.service.js        # capa de IA: backends Gemini/Claude con fallback + prompts
    contexto.js          # arma el contexto del hogar para los prompts (fuente unica)
public/
  index.html             # login / registro
  inicio.html            # DASHBOARD: saludo, comidas de hoy, plan y estadisticas
  app.html               # ESCANER de productos (semaforo)
  hogar.html             # familia, condiciones medicas, alergias, region
  despensa.html          # ver la despensa (buscar) + registrar compra (agregar producto + marcar comprados)
  compras.html           # MIS COMPRAS: lista para el super (cantidad, precio, check), PDF e historico
  plan.html              # CALENDARIO 7x3 + boton "Generar dia" con IA en cada dia
  platos.html            # "Mis Recetas": el recetario (crear/editar/borrar)
  analisis.html          # ANALISIS DE CONSUMO: que se comio en un rango y que dice de ello
  mi-plan.html           # "Mi suscripcion": planes y pago Yape
  soporte.html  admin.html
  css/style.css  js/api.js  js/vendor/jspdf.umd.min.js  sw.js  manifest.webmanifest
  img/                   # logo, favicon, iconos PWA, personajes del semaforo
pruebas/                 # smoke tests con jsdom (ver pruebas/README.md)
uploads/                 # comprobantes de Yape + QR
nutrichefia.db           # base de datos (se crea sola al arrancar)
```

**Falta crear:** nada bloqueante. Todas las páginas que enlaza el sidebar existen.

## Modelo de datos (SQLite)

La BD **nació vacía**, así que el esquema está completo y limpio desde el día 1: **no hay migraciones de compatibilidad** ni columnas heredadas reusadas con otro significado (el `incluye_botiquin`-que-en-realidad-era-Loncheras de NutriIA **no** se arrastró). Si cambias el esquema, agrega la migración idempotente en `db.js`.

- **planes**: todo límite en `NULL` = **ilimitado**. `analisis` (escaneos incluidos), `historial_max` (`0` = no guarda), `platos_max`, `semanas_max` (semanas distintas programables), **`generaciones_max`** (llamadas IA del planificador **por semana** — el cuello de costo), `dias_vigencia` (default 30), `incluye_planificador`, `es_default`, `activo`. Sembrados: **Free** (3 análisis, 3 guardados, 5 platos, 1 semana, **7 generaciones/semana** = una por día) y **Premium** (todo ilimitado). Admin = bypass total.
- **usuarios**: `rol` `user|admin`, `plan_id`, `analisis_restantes`, `plan_expira` (YYYY-MM-DD; NULL = sin vencimiento). `usuarioPublico` resuelve el plan, expone `dias_restantes` + `hogar_configurado` y **auto-degrada a Free** (perezosamente) si `plan_expira <= hoy`.
- **analisis**: historial del escáner. `consulta` = nombre del producto; `respuesta_json`; `input_tokens`/`output_tokens`; `proveedor` (`gemini`|`claude`). Limitado por `historial_max` (dedup por nombre, ventana rodante).
- **hogar** (1 por usuario, UNIQUE): `region` (costa|sierra|selva), `ciudad`, `dieta`, `presupuesto`, `comensales`, **`semanas`** (1..12 = cuántas semanas cubre una compra = el "periodo"; default 1; preferencia sticky), **`configurado`** = gate del onboarding (sin hogar la IA no puede proponer nada). `cadencia` (diario|semanal|mensual) quedó **heredada y sin uso** — la reemplazó `semanas`.
- **integrantes**: `condiciones` (JSON) y **`alergias`** (JSON) → las alergias son **exclusión dura** en el prompt, no una preferencia.
- **ingredientes_catalogo** (admin): base para abastecer la despensa. Categorías de cocina real (abarrote/verdura/fruta/carne/pescado/lacteo/huevo/legumbre/condimento/bebida/otro). Sembrado con ~51 ingredientes peruanos.
- **despensa**: inventario **por porcentaje** — **`porcentaje`** (0-100) es la **fuente de verdad** y significa **qué fracción de lo que necesita para el periodo tiene** (no "qué fracción del envase"; ver el punto rojo en "Consumo de la despensa"). **`nivel`** (`poco|normal|bastante`) quedó como campo **derivado** (`nivelDePorcentaje`: ≤30 poco, ≤70 normal, >70 bastante), que solo existe porque lo consumen el prompt de la IA y el snapshot de `compra_items`. **Nunca escribas `nivel` suelto**: se recalcula en cada escritura de `porcentaje`, para que no puedan contradecirse (una barra al 10% etiquetada "bastante"). UNIQUE por usuario + nombre normalizado. **Sigue sin haber gramos**: esa decisión no cambió (conversión de unidades + mermas). Lo que baja el porcentaje es el consumo de los platos programados, y **solo al marcarlos cocinados** — ver "Consumo de la despensa".
- **compras**: registro de una compra de un periodo = los productos que el usuario **marcó como comprados**. **`periodo_inicio`/`periodo_fin`** = el tramo que cubre (N semanas o fechas a medida); `total_items` = cuántos productos marcó. **No es un reset**: la despensa persiste y sigue cambiando. `semana` (= lunes del inicio) se conserva por compatibilidad. Ver "Compra por periodo" en Lógica.
- **compra_items**: el **detalle congelado** de la compra (`nombre`, `categoria`, `nivel`) por cada producto marcado. Vive aparte de `despensa` (que es mutable) para que el historial de "qué compré en el periodo X" no se reescriba al editar la despensa. `ON DELETE CASCADE` con `compras`.
- **platos**: `ingredientes` (JSON `[{nombre,cantidad,unidad}]`), `faltantes` (JSON: lo que no estaba en la despensa al generar), **`pasos`** (JSON | **NULL hasta que se pidan** — hoy siempre NULL, los llena la fase 4), `info` (JSON | idem), `nota` (adaptación por condición médica), `momento`, `porciones`, `tiempo_min`, `dificultad`, `origen` (`ia`|`propuesto`|`manual`), **`guardado`**.
  > **`guardado` separa la biblioteca del plan**, y no es cosmético: llenar una semana crea **21 platos** y el plan Free permite **5**. Si `platos_max` contara todos, planificar sería imposible. El tope aplica a lo que el usuario decide **curar** (`guardado=1`), no a lo que la IA produce para el calendario.
- **plan_comidas**: calendario. `semana` = fecha del **lunes**; `dia` 0..6 (0=Dom); `momento`; **UNIQUE(usuario, semana, dia, momento)** = una casilla, un plato. **`cobertura`** (JSON de la verificación contra la despensa) vive aquí y **no** en `platos`: el plato es estable, lo que cambia es la despensa (mismo plato puede "alcanzar" esta semana y "faltar" la otra). **`consumo_aplicado`** (JSON `{despensa_id: puntos}`) guarda lo que esta casilla le **descontó de verdad** a la despensa al marcarse cocinada: se registra lo aplicado y no lo estimado porque el descuento se topa en 0, y sin eso desmarcar devolvería un porcentaje que nunca se quitó.
- **generaciones**: log de llamadas IA del planificador (`tipo`: menu|dia|plato|detalle|verificar). Cumple **dos** funciones: el gate `generaciones_max` por semana **y** el costo real en el admin.
- **pagos**: `numero_operacion` UNIQUE, `comprobante_path`, `estado` `pendiente|aprobado|rechazado`.
- **config**: clave/valor (`yape_numero`, `yape_titular`, `yape_qr_path`, `ai_modo`, `ai_prioridad`, `credito_gemini`, `credito_claude`, **`ia_instrucciones`**). `ia_instrucciones` = instrucciones generales del admin para la IA (texto libre, editable desde el panel); se anteponen al contexto de **todos** los flujos del planificador — ver `contexto.js`.

## Lógica de negocio crítica

### Candado freemium del escáner (`middleware/freemium.js`)
- `ilimitado` (admin o plan sin tope) → pasa libre.
- Sin saldo → **HTTP 402** `{ paywall, redirect: '/mi-plan.html' }`.
- **No descuenta en el middleware**: expone `req.consumirAnalisis()` (y `descontarAnalisis(usuario)`), que la ruta llama **solo si la IA respondió bien**. Nunca cobrar un análisis fallido.

### Escáner + cache-first (`analisis.routes.js`)
- **`POST /texto`** `{producto}`: **cache-first** — si el producto ya está en `analisis` (match `LOWER(TRIM(consulta))`) devuelve el guardado (`cacheado: true`) **sin IA ni descuento**. Cache-miss → freemium inline → IA → `guardarHistorial`.
- **`POST /imagen`** (multipart): **`ingredientes` obligatoria + `nombre` opcional**.
  - ⚠️ **Comprimir las imágenes en el navegador** antes de subir (`comprimirImagen()` en `app.html`, máx **1568 px** + JPEG q0.72). El gateway de Claude **cuenta el base64 como tokens de entrada**: una foto full de celular disparaba ~2.6M tokens (~$7/análisis). Gemini tokeniza la imagen normal. **No quitar la compresión.**
- `guardarHistorial` respeta `historial_max`, dedup por nombre, **no guarda errores**.
- Errores de IA → **HTTP 502** (no 500), para no descontar.

### Hogar (`hogar.routes.js`, gate `requierePlanificador`)
- **Dos invariantes derivados**, mantenidos por `recalcularHogar()` — el cliente **no** los envía:
  - `comensales` = **COUNT(integrantes)**. Es una sola fuente de verdad: un campo aparte se desincronizaría de la lista real y la IA escalaría mal las porciones.
  - `configurado` = hay **≥1 integrante**. Antes de eso la IA no tiene con qué trabajar.
- El hogar se **autocrea** vacío al primer `GET` (con los defaults del esquema), así el formulario siempre tiene algo que pintar.
- `condiciones` y `alergias` son **texto libre**: las listas `CONDICIONES_COMUNES`/`ALERGIAS_COMUNES` son solo sugerencias del formulario. Una familia real puede tener algo que no está en nuestra lista.
- Ojo: este módulo **NO** usa `requiereHogar` — es justamente el que lo configura (gallina y huevo).

### Despensa (`despensa.routes.js`, gate `requierePlanificador`)
- **Inventario por porcentaje**: `porcentaje` (0-100) manda, `nivel` se deriva (ver decisión arriba). `PATCH /api/despensa/:id` acepta **`porcentaje`** (la barra) o **`nivel`** (el select de "Agregar un producto", que es más cómodo justo después de comprar): una sola escala en la BD, dos formas de escribirla.
- **`GET /api/despensa?inicio=&fin=`** devuelve, además del stock, la **proyección** de esa ventana: `consumo_previsto` y `restante` por producto. Sin parámetros, la **semana actual**. `POST`, `PATCH`, `DELETE` y `/compra` devuelven la despensa con la misma forma.
- **Nunca duplica**: hay un UNIQUE sobre `(usuario_id, LOWER(TRIM(nombre)))`. `guardarIngrediente()` resuelve el upsert **a mano** (busca y luego UPDATE/INSERT) porque el índice es sobre una **expresión**.
- **Categoría automática**: si el ingrediente está en `ingredientes_catalogo`, hereda su categoría; si no, cae a `otro`. El usuario no tiene que clasificar nada. `POST /api/despensa` respeta la categoría si viene en el body; si no, sigue la regla automática.
- **🔴 HAY UNA SOLA DESPENSA, y NO pertenece a un periodo.** La tabla `despensa` no tiene columna de semana ni de periodo: es **el estado de la casa hoy**. Lo que tiene fechas es la **compra** (`compras.periodo_inicio/fin` + el snapshot congelado en `compra_items`), y lo único que depende de la semana es **cuánto se lleva el plan de esa semana** (`consumo_previsto`). **No hay histórico de stock**: no existe forma de saber cuánto arroz había el 13/07, solo el nivel que tenía *al comprarlo*.
  - ⚠️ **El lenguaje importa aquí más que en ningún otro sitio.** El badge del plan y el banner de la despensa decían *"📦 Despensa del periodo 27/07 – 02/08"*, que se lee como que **cada semana tiene su propia despensa** — y así lo reportó el usuario (2026-07-30: *"causa confusión de si esa despensa es de esa semana"*). Ahora dicen *"🛒 Tu compra del … cubre esta semana"* + *"🧺 Tienes una sola despensa"*. **No vuelvas a la redacción vieja**; un aserto del smoke falla si reaparece.
  - **Una despensa por periodo se evaluó y se descartó** (2026-07-30): habría que guardar stock por periodo, decidir qué se arrastra entre periodos y reconciliarlo con las ediciones manuales de la barra — para dar algo que la proyección ya da. Contradice además la decisión de *"no es un reset: la despensa persiste"*.
- **El plan y la despensa están unidos por la VENTANA, no por el periodo (2026-07-30).** Botón **"🧺 Ver mi despensa"** en el plan → abre `despensa.html?inicio=&fin=` con **la semana que estás viendo**.
  - **Arregla un bug real:** `despensa.html` pedía `/api/despensa` **sin ventana** y el backend caía a `lunesDe(fechaPeru())`, o sea la **semana actual**. Mirabas el plan del 13/07, entrabas a la despensa y las barras proyectaban el consumo del **27/07**: los números no correspondían a la semana que tenías delante. Ese desajuste es lo que hacía sentir que las dos pantallas iban por separado.
  - `qVentana()` se anexa a **todas** las llamadas que devuelven la despensa (GET, POST, PATCH, DELETE): si solo fuera en la carga inicial, mover una barra repintaría con la proyección de otra semana.
  - Con una ventana que no es la semana actual, la etiqueta dice **"esa semana −X%"** (no "esta"), el banner anuncia de qué semana son los números, y la pestaña de compra **arranca en esa semana** (vienes de ver qué te falta ahí).
- **Selector "📅 Esta semana / 📦 Todo el periodo" en la despensa (2026-07-30).** Son **dos preguntas distintas**: la semana responde *"¿me alcanza esta semana?"*; el periodo, *"¿me alcanza hasta la próxima compra?"*.
  - **Existe porque mirar semana a semana NO acumula:** cada semana se proyecta contra el stock de hoy y **ninguna descuenta las anteriores**. Con una compra de 4 semanas, ninguna pantalla avisaba de que al final del periodo te quedabas sin aceite. Un rango sí suma: medido, `233 pts en una semana → 340 pts en el rango completo`, y por ingrediente es aditivo exacto (`Huevo: 32% + 4% = 36%`).
  - **Solo se ofrece si hay algo que elegir:** con una compra de una sola semana las dos opciones darían el mismo número y el selector sería ruido.
  - **`nombreVentana()` decide en un solo sitio** cómo se llama la ventana (`esta semana` / `esa semana` / `todo el periodo`). Llamar "esta semana" a los números de un periodo de un mes es falso, y esa clase de imprecisión es la que generó la confusión original.
  - Cambiar de ventana **no recarga la página**: solo vuelve a pedir la despensa con el rango nuevo. El stock no cambia (es uno solo); lo que se recalcula es la proyección.
- **Agregar ≠ comprar (modelo 2026-07-18).** Son **dos conceptos separados**, y viven en **dos pestañas**:
  - **"🧺 Mi despensa" = SOLO ver + buscar.** Muestra el stock agrupado por categoría (con su **barra de porcentaje** y quitar) + un buscador por nombre. **No tiene formulario de agregar** — para no confundir "tener" con "comprar".
  - **"🛒 Registrar compra" = agregar + marcar.** Arriba, el **formulario "Agregar un producto"** (nombre + categoría autosugerida + nivel) → alta INMEDIATA a la despensa (`POST /api/despensa`) y queda marcado en el checklist. Debajo, el **checklist por categoría**. Ver los dos bullets siguientes.
- **Debajo de cada producto: "🧾 Tu plan pide 16 dientes" (2026-07-30).** Sale de **`GET /api/plan/necesidad`** y va **siempre visible**, marcado o no: es el dato con el que se decide si hay que traerlo y cuánto.
  - ⚠️ **Usa `/necesidad`, NO `/faltantes`.** `/faltantes` omite por definición todo lo que el usuario **ya tiene**, que es la mayor parte de esta lista — y es justo de eso de lo que decide si repone. Medido en el hogar de prueba: **35 ingredientes en el plan vs 18 faltantes**. Si alguien cambia la llamada a `/faltantes`, dos tercios de la pantalla se quedan sin cantidad; lo fija un aserto del smoke.
  - Es **una sola llamada**: los faltantes (el `●`) salen de filtrar `falta === true`. Así las dos listas no pueden decir cantidades distintas del mismo ingrediente.
  - Si no hay cantidad (el plan no usa ese producto, o sus platos son manuales sin cantidades) **no se pinta nada** — mejor que inventar una cifra. Medido: 32 de 35 con cantidad.
  > **Ojo con dónde se busca este dato.** Las cantidades se estrenaron **solo** en *Plan de comidas → 🛒 Lista de compras*, y el usuario las fue a buscar a *Registrar compra*, que es donde de verdad las necesita (es la pantalla en la que decide qué traer del mercado). Si añades un dato del plan, pregúntate en qué pantalla se toma la decisión que ese dato informa.
- **Cada producto marcado dice CUÁNTO se compró (2026-07-29).** Al marcarlo aparece su **barra 0-100** y **100% = "compré todo lo que mi plan necesita para este periodo"** (mismo ancla que la despensa, ver "Consumo de la despensa"). Arranca en 100 porque es el caso normal; bajarla es la excepción: *"solo alcancé a traer la mitad"*. Antes todo lo marcado iba al 100% sí o sí, y la única forma de corregirlo era ir a "Mi despensa" a mover la barra producto por producto **después** de registrar.
  - `POST /compra` acepta **las dos formas** de `items`: `["Arroz"]` (= 100%, lo que mandaba el cliente viejo) o `[{nombre, porcentaje}]`. El `nivel` de `compra_items` **se deriva** de ese porcentaje, nunca se escribe suelto — misma regla que el resto de la despensa.
  - La barra solo se pinta si el producto está **marcado**: preguntar cuánto compraste de algo que no compraste no significa nada. El slider va de **10 a 100** (marcar algo y declarar 0% es contradictorio); el backend sí acepta 0-100 por si otro cliente lo manda.
  - **Sigue sin haber gramos.** El 100% es la necesidad del periodo, no una cantidad: *"compré todo el arroz del periodo"* no dice si son 2 kg o 10. Eso es a propósito (la decisión de no convertir unidades no cambió), pero el ancla ya no es arbitraria — está atada al plan.
- **El checklist ofrece DOS conjuntos, no solo la despensa (2026-07-27).** (1) lo que **ya tienes** —aunque te quede stock: lo normal es reponerlo— y (2) los **faltantes del plan de ese periodo** (`GET /api/plan/faltantes`), marcados con **`●`**. Los de (2) son justo los que traes del mercado, y antes había que darlos de alta **uno por uno** con "+ Agregar" antes de poder marcarlos. Al registrar, `POST /compra` **da de alta** los que no existían (con el porcentaje de su barra y la categoría del catálogo) y responde `nuevos` para avisarlo.
  - **Los (1) arrancan MARCADOS y los (2) NO.** No haber comprado algo es normal (no había en el mercado), y dar de alta un producto que no compraste es peor que un clic de más: **la IA planifica alrededor de lo que encuentre en la despensa**. "Todos" sí marca ambos.
  - La lista se **recarga al cambiar el periodo**: si estiras la compra de 1 a 4 semanas, los faltantes crecen. Si el plan no está disponible (403 del gate, o aún no hay platos), degrada sin ruido a solo la despensa.
  - El alta va **dentro de la transacción** de la compra: productos dados de alta sin la compra que los explica es el mismo problema que una compra a medias.
- **`POST /compra`** registra la compra del periodo completa **en una transacción**: una compra a medias dejaría a la IA proponiendo platos con ingredientes que el usuario no llegó a registrar.
- **Quitar un registro del historial (`DELETE /api/despensa/compras/:id`, 2026-07-29).** Botón "Quitar" en cada fila de "Compras anteriores", con el modal propio `confirmar()`.
  - **Borra el REGISTRO, no el stock.** Es la distinción que importa: `compras` es el historial de *"qué traje del mercado y para qué periodo"*; la despensa es lo que hay en casa **ahora**. Si borrar una compra vieja vaciara la despensa, el usuario perdería su inventario por limpiar una lista — y la IA planificaría alrededor de una casa vacía.
  - **Quien lo garantiza es el esquema, no la ruta:** `compra_items` es `ON DELETE CASCADE` (el detalle congelado se va con su compra) y **`despensa.compra_id` es `ON DELETE SET NULL`** (el producto se queda, pierde solo el vínculo). ⚠️ **Si cambias esos FK, esta ruta se vuelve destructiva sin que nadie la toque.** Lo cubre `npm run smoke` con el aserto *"LA DESPENSA QUEDA IDENTICA"*.
  - **Efecto secundario que el modal SÍ avisa:** el banner de la despensa y el badge del plan leen la compra **más reciente**, así que borrar esa cambia el "periodo activo" al de la anterior (o a ninguno). La fila más nueva se marca *"· periodo activo"* para que no sea una sorpresa. Sin ese aviso, el banner cambiaría solo y parecería un bug.
- **`compras.total_items`** guarda cuántos ingredientes traía la compra **al registrarla**. Los ítems viven en `despensa`, que es mutable: contar por `compra_id` daría un historial que se reescribe solo ("compré 6" pasaría a decir 5 al borrar uno). El conteo por `compra_id` sigue exponiéndose, pero como **`vigentes`**, que significa otra cosa.
- **Registrar compra = marcar lo comprado del periodo (2026-07-18).** La pestaña "🛒 Registrar compra" muestra los productos de la despensa **por categoría con un checkbox cada uno** (arrancan **todos marcados** — lo común es que compraste tu stock; desmarca lo que ya tenías) + los botones **Todos/Ninguno**. El **formulario "Agregar un producto"** (arriba) da de alta uno que compraste y **no estaba en la despensa** (alta inmediata + queda marcado). `POST /compra` recibe **`items` = lo marcado**; la categoría **se resuelve contra la despensa** (no se confía en el cliente), crea la `compra` + congela el detalle en `compra_items`, responde *"Se guardó la despensa del periodo …"* y la compra **aparece en "Compras anteriores"**. Los productos **no marcados no se tocan** (su stock persiste); los **marcados quedan en el porcentaje que el usuario declaró** — ese es el punto de partida de la barra que cierra el ciclo *comprar → cocinar → se vacía → vuelve a la lista de compras*. El periodo se define de **dos formas**:
  - **N semanas enteras** (`semanas`, 1..12): `periodoSemanas(inicio, n)` en `db.js` ancla el inicio al **lunes** y `fin = inicio + N*7 − 1`. N queda sticky en `hogar.semanas`. Como el periodo es en semanas enteras, **calza con la unidad de edición del plan** (que sigue siendo la semana): un periodo de N semanas **cubre N semanas de planificación**.
  - **Fechas a medida** (`periodo_inicio` + `periodo_fin`): el usuario fija el rango exacto; no toca la preferencia sticky.
  - **Concepto de "agotado":** pasado el periodo se entiende que se agotó y hay que volver a registrar (no hay borrado automático). El **banner** de la despensa y el **badge** del plan avisan a qué periodo pertenece (y si venció). El badge del plan muestra *"semana X de N"* del periodo activo (= la última compra registrada).

### 🔴 LA DESPENSA ES UN MÓDULO OPCIONAL Y NACE APAGADA (2026-08-24)

`hogar.despensa_activa` (0 por defecto) decide si el módulo existe para ese hogar. **No es "ocultar la pantalla": es un interruptor de verdad.** Con la despensa apagada:
- **La IA ni la ve.** `contextoDe()` **no la consulta siquiera** cuando está apagada. Se corta en la fuente a propósito: si se consultara y se filtrara más adelante, cualquier flujo nuevo que olvidara el filtro la colaría.
- **Se le DICE que no hay inventario**, no basta con omitir el bloque: las reglas del prompt hablan de la despensa, y sin ese aviso la IA se inventa que el hogar "tiene" cosas o marca faltantes que no significan nada. El texto le pide explícitamente `"faltantes": []` y `"consume": 0`.
- **No hay consumo.** `indiceDespensa()` devuelve `[]`, y con eso se apagan de golpe los dos caminos (la proyección y el descuento al marcar cocinado) sin que ninguno tenga que acordarse del interruptor.
- **Desaparece de los menús** (lateral e inferior), del plan (botón de despensa, lista de compras y badge de periodo) y del dashboard. Un enlace a una sección que no hace nada es peor que no tenerlo.

**APAGAR NO BORRA NADA.** Los productos y las compras se quedan intactos: volver a encender devuelve el inventario tal cual. Lo cubre un aserto del smoke, porque es justo lo que haría dudar a alguien antes de probar el interruptor.

**Reiniciar a cero (`POST /api/despensa/reiniciar`)** es lo otro: sí borra, y borra **productos + historial de compras + el `consumo_aplicado`** de las casillas (apuntaba a filas que ya no existen; sin limpiarlo, desmarcar un plato intentaría devolver stock a productos borrados). **No toca** el plan de comidas, los platos ni el hogar: borrar el inventario no debería costarte el calendario. Todo en una transacción.

⚠️ **`usuarioPublico` vuelve a ser la trampa.** Su `SELECT` del hogar es explícito (`SELECT configurado, despensa_activa`): al añadir una columna del hogar que el front deba ver hay que tocarlo ahí también, o la ruta guarda bien y devuelve el valor viejo. **Ya pasó dos veces** (con `usuarios.foto` y con esta).

**El usuario se refresca en segundo plano** (`refrescarUsuario()` en `api.js`). `exigirSesion()` lee localStorage, que es una foto del login: sin refresco, activabas la despensa en el teléfono y en la laptop seguía sin salir hasta volver a entrar. Solo repinta la navegación **si algo cambió**, para no provocar un parpadeo en cada carga. De paso arregla que el plan se actualice cuando el admin aprueba un pago.

> **Decisiones del 2026-08-24, tomadas por el usuario tras plantearle las alternativas:** sin despensa **no se ofrece lista de compras** (se evaluó convertirla en "todos los ingredientes del plan" y se descartó); el valor por defecto es **apagada para todos, incluidos los que ya la usaban** (se advirtió que a 3 usuarios de producción se les apagaría, y se aceptó — mitigado porque apagar no borra); y reiniciar **borra también el historial de compras**.

### Consumo de la despensa (`services/consumo.js`) — ✅ hecho (2026-07-27)
La barra de cada producto **baja sola** con lo que la familia cocina. Vive en su propio
servicio porque lo usan **dos caminos que tienen que dar el mismo número**, o el usuario ve
una barra que no cuadra con lo que se le descuenta:

1. **Proyección** — *"esta semana te va a bajar el ají amarillo a 5%"*. **No toca la BD.**
2. **Descuento** — al marcar la casilla **cocinada**, ese mismo cálculo se **aplica**.

> **Programar NO descuenta.** Se evaluó descontar al poner el plato en la casilla y se
> descartó: cada camino que toca el calendario (generar, rehacer día, copiar semana, borrar
> plato, el CASCADE al borrar de la biblioteca) tendría que acordarse de devolver el
> porcentaje, y el primero que se olvidara dejaría el stock mintiendo para siempre. Con la
> proyección no hay nada que revertir — y el usuario igual **ve** el efecto de su semana
> antes de cocinarla, que es para lo que sirve.

- **De dónde sale "cuánto consume este plato de este ingrediente":**
  - **Primero la IA**: cada ingrediente generado trae **`consume`** (0-100 = qué % del stock
    se lleva ese plato), en `FORMATO_CONSUME`. Es la **única** fuente que distingue una
    cucharadita de ají de medio kilo de pollo, y **viaja en la misma llamada** que el plato,
    así que **no cuesta una generación extra de cupo**. Lo piden **los tres** flujos de IA:
    generar (`FORMATO_PLATO`), verificar (`FORMATO_COBERTURA`) y —desde 2026-07-29— el
    backfill de `/detallar`, que es el único camino por el que un plato **ya existente** puede
    conseguirlo.
  - **Después la heurística** (`PESO_CATEGORIA`), para lo que nació sin ese dato: los platos
    manuales de la biblioteca (los escribe el usuario, no pasan por IA) y los viejos que
    todavía no se han completado con `/detallar`.
- **🔴 EL 100% ES LA NECESIDAD DEL PERIODO, NO EL ENVASE (cambio del 2026-07-29).** Un producto
  al 100% significa *"tengo todo lo que necesito de esto para el periodo que compré"*; al 50%,
  *"me alcanza para la mitad"*. **No** significa "la bolsa está llena", que es lo que significaba
  antes. Con el envase como referencia los números no cuadraban con nada: un `consume 90` de
  arroz quería decir "se lleva casi toda tu bolsa", no "se lleva casi todo lo que necesitas
  esta semana" — y el usuario preguntó exactamente eso. Con la necesidad como ancla el modelo
  **cierra y es comprobable**: cocinar todo lo planificado del periodo deja cada producto cerca
  de 0, y la barra por fin responde *"¿me alcanza?"*.
  - **A la IA se le pide SIEMPRE sobre UNA SEMANA** y **el backend divide por `semanas`**
    (`semanasDelPeriodo`, que lee `hogar.semanas`). Pidiéndolo directamente sobre un periodo de
    12 semanas, la parte de un plato sería ~1%: entero, redondeado, y la barra no se movería
    nunca. La división y el redondeo van **solo en `cerrar()`**; la acumulación es decimal a
    propósito (redondear por plato desviaba la suma de la semana un ~33%).
  - **La regla que comparten la IA y la heurística: 100 repartido entre los platos de la semana
    que usan ese producto.** Si el arroz entra en ~5 almuerzos, un almuerzo se lleva ~20; si la
    sal entra en casi los 21 platos, ~5. Si las dos fuentes no compartieran criterio, dos platos
    iguales moverían la barra distinto según quién los creó.
  - **Verificado con IA real (Gemini, 2026-07-29):** un día generado devolvió `Arroz 20`
    (era 90 con el ancla vieja), `Sal 5` (era 2), `Carne de cerdo 40`, `Pollo 30`,
    `Comino/Pimienta 10`. Y cierra: `arroz 20 × ~5 almuerzos = 100` de la semana.
  - **`config.consume_escala` = `'necesidad-semanal'`** marca la BD ya migrada. La migración
    (en `db.js`) **borra el `consume` de todos los platos** porque los valores viejos siguen
    siendo enteros 0-100 válidos y **nada los detectaría**: es un cambio de *significado*, no de
    formato. El plato queda pendiente y el usuario lo recompleta con "🍳 Completar platos".
- **Las dos fuentes se ACUMULAN IGUAL: se SUMAN.** Ambas son ya una fracción de lo mismo (lo
  que la familia necesita en una semana), así que dos platos que piden 20 piden 40 de la semana.
  Llegar a 100 tras una semana de platos es exactamente lo que debe pasar.
  > ⚠️ **Antes la heurística SATURABA** (`total = 1 − (1−w)^n`) y no era un capricho: con el
  > ancla vieja, sumarla linealmente dejaba el aceite y el ajo en **0%** en una semana, porque
  > una casa compra los básicos en envases proporcionales a lo que los usa. Al pasar el ancla a
  > la necesidad, esa corrección sobra. **Si vuelves a tocar la escala, mira las dos cosas
  > juntas** — la fórmula de acumulación y el ancla no son independientes.
- **`PESO_CATEGORIA` sale de CONTAR una semana real, no de estimar a ojo.** En la semana
  sembrada del hogar de prueba (21 platos) la cebolla entra en 14, el ajo en 12, la sal en ~18 y
  el pollo en 7. Con el `carne: 33` inicial (que asumía 3 platos), esos 7 platos de pollo
  proyectaban **−77% de un periodo de 3 semanas** — una semana no puede comerse tres cuartos de
  una compra de tres. Recalibrado (`carne: 16`, `verdura: 9`, `abarrote: 12`, `condimento: 6`,
  `legumbre: 50`…), la misma semana proyecta entre −4% y −43% con media **−22%** contra un
  objetivo de −33%. **Sigue siendo grueso**: la papa y la cebolla son las dos `verdura` y no
  aparecen ni las mismas veces ni en la misma proporción del plato. Por eso es solo el respaldo
  de los platos manuales. Ojo con un detalle de datos: en `ingredientes_catalogo` la **sal y el
  azúcar son `abarrote`**, no `condimento`, así que se llevan el peso de abarrote.
- **El emparejamiento ingrediente↔despensa aquí es LOCAL, no de la IA** (la IA sí lo hace en
  el prompt, donde tiene la despensa delante). Se compara por **conjunto de palabras, no por
  substring**: `"sal"` está contenida en `"salsa de soya"`, y descontarle el stock de sal a
  una salsa sería un error silencioso que el usuario no tiene cómo notar. Gana la
  coincidencia **exacta**, y si no, la **más específica** (para que "Ají amarillo" no se
  lleve el descuento de un "Ají" genérico). Verificado: `Pechuga de pollo → Pollo`,
  `Salsa de soya → (sin match)`.
  - **Consecuencia que parece un bug y no lo es:** si la despensa tiene *"Pollo"* **y**
    *"Pechuga de pollo"* como dos productos, un plato que pide "pechuga de pollo" descuenta
    **solo de la pechuga** y el "Pollo" se queda intacto. Se reportó como *"cociné arroz con
    pollo y el pollo sigue al 100%"* (2026-07-29) y es el comportamiento correcto: son dos
    productos distintos en la despensa del usuario. Antes de tocar el emparejamiento, mira si
    hay un producto **más específico** que sí bajó.
- **Los faltantes se excluyen**: si la IA ya dijo que ese ingrediente no lo tiene (o que su
  versión normal no le sirve por una condición médica), **no puede salir de la despensa**.
  Sin esto, un hogar con "Arroz" vería bajar su arroz por un plato de *"arroz integral"* que
  está justamente en la lista de compras **porque no lo tiene**.
- **La proyección solo cuenta las casillas NO cocinadas**: lo que ya se cocinó se descontó de
  verdad, y volver a proyectarlo lo restaría dos veces.
- **La edición manual manda.** El usuario mueve la barra (`.stock-rango`) y eso es lo que
  queda: es el único que sabe cuánto le queda de verdad en la olla.
- **UI:** la barra tiene **dos tramos** (`.stock-tiene` sólido = lo que le queda hoy;
  `.stock-consumo` **rayado** = lo que se llevarían los platos programados). El rayado es a
  propósito: es una proyección, y pintarla sólida haría creer que ya se gastó. El color del
  tramo sólido responde a lo que le **quedará**, no a lo que tiene: la pregunta que el
  usuario trae a esa pantalla es *"¿me alcanza?"*.

### IA (`services/ai.service.js`) — el corazón
**Proveedor configurable en runtime + fallback.** Lee de `config`: `ai_modo` (`gemini`|`claude`|`ambos`) y `ai_prioridad`. Con `ambos` usa el prioritario y, si falla tras sus reintentos, **cae automáticamente** al otro.

- **Diseño (distinto al de NutriIA):** cada backend expone **un solo método**, `pedir(system, partes, maxTokens)`, y los métodos de dominio se escriben **una vez** sobre esa base. En NutriIA cada método se duplicaba por proveedor; con los 5+ métodos que suma el planificador eso no escalaba.
- **`partes`** es el formato neutral del contenido: `[{ texto }, { imagen: { base64, mediaType } }]`. Cada backend lo traduce a su dialecto.
- **`pedir()`** es el punto único de llamada: aplica el orden de proveedores, el fallback y adjunta `usage.proveedor` (quién atendió → costo por proveedor).
- **`conReintentos`**: 3 intentos con backoff ante transitorios — 429/503/`UNAVAILABLE`/overloaded **y respuestas vacías del gateway** (el parseo va **dentro** del reintento).
- **Claude + gateway:** la respuesta puede traer bloques `thinking` antes del `text`; se unen **todos** los bloques `type:'text'` (no leer `content[0]` a ciegas). No volver al patrón viejo.
- **Gemini**: `gemini-2.5-flash`, `responseMimeType: 'application/json'`, **thinking off** (`thinkingBudget: 0`). Si cambias a `gemini-2.5-pro`, quita `thinkingBudget`.
- `parseJSON()` tolerante (quita fences, extrae el primer `{...}`).

### Costo de IA — la lección heredada
El panel de NutriIA solo contaba `lecturas` y dejaba fuera las evaluaciones de recetas. Aquí **el planificador es lo caro** (una semana ≈ 10x un escaneo), así que:
- Toda llamada del planificador se registra en **`generaciones`** (con tokens y proveedor).
- `GET /api/admin/resumen` suma **las dos fuentes** (`analisis` UNION `generaciones`) para el costo por proveedor, con `credito`, `restante` y flags `bajo` (≤20%) / `agotado`.
- `POST /api/admin/tokens/reset` pone a cero los tokens de **ambas** tablas.
- El gate `generaciones_max` es **por semana**: sin él, un usuario Free podría rehacer sus días 50 veces.

### Plan de comidas (`plan.routes.js`, gates `requierePlanificador` + `requiereHogar`)
- **Casilla = `UNIQUE(usuario, semana, dia, momento)`**. `ponerEnCasilla()` reemplaza lo que hubiera y limpia el plato anterior.
- **Orden de los días:** la BD usa `0=Domingo` (como `Date.getDay()`), pero la semana **empieza el lunes**. El mapeo vive en `DIA_NUM = [1,2,3,4,5,6,0]` (backend y front). El domingo es el **séptimo** día: `fechaDe(0)` = lunes + 6.
- **La unidad de generación es el DÍA, no la semana.** `POST /generar` recibe **casillas**: 3 (el día) o 1 (un plato). Es la **única** ruta de generación. Se le manda lo que ya hay esa semana para que no repita, y lo que se está reemplazando para que no lo vuelva a proponer. Si la IA no devuelve una casilla, esa queda como estaba en vez de tumbar el resto.
  > **Antes existía un `POST /generar` que armaba los 21 platos de una llamada y se eliminó a propósito** (2026-07-15). No fue por costo — medido, día a día sale **igual o más barato** (ver tabla). Fue porque el usuario arma su semana **poco a poco, mezclando platos suyos con generados**, y aquella ruta **borraba la semana entera** antes de escribir: le habría destruido los platos que eligió a mano. No la reintroduzcas sin resolver eso.
- **Generar un día llena solo las casillas VACÍAS.** La UI calcula cuáles están libres y manda esas; si el día está lleno, el botón pasa a "Rehacer día" y **confirma** antes de pisar. El backend reemplaza lo que se le pida —decidir qué mandar es del cliente—, así que si agregas otro cliente, esa regla es tuya. El smoke test la verifica (`smoke:plan`).
- **El emparejamiento casilla↔plato tiene DOS vías: etiqueta y, si falta, POSICIÓN.** La IA debe marcar cada plato con su `dia`/`momento`, pero **Claude no lo hace**: sigue `FORMATO_PLATO` al pie de la letra y ahí esas dos etiquetas no figuran (Gemini sí las pone). Emparejando solo por etiqueta, **generar un día con Claude descartaba los 3 platos buenos y devolvía 502**, mientras que pedir 1 plato funcionaba de casualidad por un `|| platos[0]`. Por eso `platoDe()` cae a la posición: el plato i-ésimo es el de la casilla i-ésima. **El prompt es una petición, no una garantía** — y el momento real lo pone `crearPlato()` desde `c.momento`, nunca desde lo que diga la IA.
- **La despensa se reparte con `ingredientesComprometidos()`.** Generando la semana de un golpe, la IA repartía la despensa entre los 21 platos con visión global; de a un día no ve el resto del calendario y gastaría dos veces el mismo *"tengo: poco"*. Por eso al prompt se le mandan los **ingredientes ya comprometidos** por los platos que esa semana ya tiene (nombre + en cuántos platos), no solo los nombres de los platos: *"Ají de gallina"* no le dice que el pollo ya está tomado. Se mandan nombres + conteo y no cantidades: es lo que necesita la regla 4 del prompt y cuesta ~10x menos tokens.
- **Platos huérfanos:** un plato generado que ya no está en ningún plan y que el usuario no guardó en su biblioteca se borra (`limpiarPlatoHuerfano`). Sin esto, cada regeneración dejaría basura acumulándose.
- **`POST /copiar`** apunta a los **mismos** platos, no los duplica: un plato es una receta y la misma receta puede estar en dos semanas.

**El plato nace COMPLETO en UNA llamada.** `generarPlatos(...)` devuelve, por casilla:
nombre + ingredientes + faltantes + nota + **`pasos` (la receta)** + **`info` (aporte
nutricional)**. No hay 2ª llamada.

> Hubo un plan de "generación en dos pasos" (1: el plato; 2: nutrición y receta aparte, al
> abrirlo) y **se descartó**: cada campo que se pide aparte es **otra llamada = otra
> generación de cupo**, y con el Free en 7/semana (una por día) el usuario se quedaría sin
> cupo por *leer* sus propias recetas. Pedir todo junto cuesta ~31% más por día pero es
> **una sola** llamada, no se paga dos veces el contexto y el plato ya está listo al abrirlo.
> `POST /api/plan/detallar` sobrevive **solo como backfill** de los platos viejos.

### Aporte nutricional del plato (`platos.info`)
Cada plato trae `info` = `{ calorias, carbohidratos, proteinas, grasas, destacados[], semaforo, resumen }`.
Los macros y el semáforo son **enums** (`alto|medio|bajo`, `verde|ambar|rojo`); `normInfo()`
en `plan.routes.js` los normaliza y **descarta lo que no encaje** (la IA a veces responde
"medio-alto" o "amarillo"). `info = NULL` significa **"sin analizar todavía"**, y es lo que
dispara el botón "Analizar nutrición".

- **`FORMATO_INFO` en `ai.service.js` es la fuente única** del formato: lo comparten generar
  y detallar. Si cada flujo tuviera el suyo, el mismo plato daría números distintos
  según por dónde se pidió.
- **El semáforo es "saludable **para este hogar**"**, no en abstracto: depende de sus condiciones
  médicas. Por eso `detallarPlatos` también recibe el contexto del hogar aunque no planifique nada.
- Al prompt se le exige ser **honesto aunque él mismo haya propuesto el plato**. Funciona:
  en un menú real medido salió **13 verde / 8 ámbar** (marcó "ocasional" platos propios por
  los carbohidratos frente a la diabetes del hogar). Si saliera todo verde, el semáforo sería
  decorativo — es la señal de que el prompt se rompió.
- **`POST /api/plan/detallar`** (`tipo='detalle'`) es **solo backfill**: completa la `info`,
  los `pasos` y/o el **`consume`** de los platos que nacieron sin ellos (se sumaron en tres
  tandas —nutrición, receta, consume—, así que hay platos con unas y sin otras). Los platos
  nuevos ya nacen con las tres y **no pasan por aquí**. Es **batch** (los pendientes de la
  semana = 1 llamada) y, si no falta ninguno, **responde sin llamar a la IA ni consumir
  cupo**: no se cobra por no hacer nada. Una vez calculados son cache permanente.
  - Cada plato le dice a la IA en **`necesita`** qué le falta (`info`, `pasos`, `consume` o
    varios), y la ruta **solo escribe lo que faltaba**: pedir o pisar lo que el plato ya tenía
    sería pagar dos veces y arriesgar que se lo reescriba distinto.
  - **El `consume` es el único campo del backfill que reescribe `platos.ingredientes`**, y por
    eso `fusionarConsume()` (en `plan.routes.js`) solo **agrega el número**: nombre, cantidad
    y unidad se quedan como estaban. El emparejamiento es por **`claveIng`, no por posición** —
    la IA reordena la lista con facilidad, y darle a la sal el `consume` del pollo vaciaría la
    despensa sin que el usuario tenga cómo notarlo.
  - **"Le falta el `consume`" = NINGÚN ingrediente lo tiene, no "alguno no lo tiene".** Con
    "alguno" bastaría que la IA omitiera un ingrediente para que el plato quedara pendiente
    **para siempre**: el botón no se apagaría nunca y cada clic costaría una generación de cupo
    sin arreglar nada. Lo que la IA no puntúe se queda con la heurística, que es donde estaba.
  - **El criterio de "incompleto" está duplicado en `plan.html`** (el botón "🍳 Completar
    platos (N)") y **tiene que coincidir con el del backend** — en las dos direcciones: si al
    front le falta el `consume`, el botón no aparece nunca para los platos viejos; y si usa
    "alguno" en vez de "ninguno", se queda encendido cobrando por clic.
  - Medido: 21 platos a los que les faltaba la receta = **1 llamada, 3.492/3.450 tokens, $0.0097**.
    Un plato al que solo le faltaba el `consume` = **1.538/155 tokens, ~$0.0008** (Gemini),
    con 5/5 ingredientes bien puntuados (`Avena 25, Plátano 35, Huevo 40, Aceite 2, Canela 0`).
- La UI usa las clases `sem-*-bn` del **escáner**: es el mismo lenguaje visual verde/ámbar/rojo.
  Ojo con el mapeo: la BD dice **`ambar`** y la clase CSS se llama **`amarillo`**.

> **`MAX_TOKENS_PLANIFICADOR = 24000`** y **1.600 por casilla** en `generarPlatos`. El techo por casilla fue subiendo con lo que trae el plato: ~350 tokens medidos con la receta base, ~550 al sumar `info`, **~900 al sumar `pasos`**. Con los 700 de antes, pedir un día se habría truncado — y un JSON cortado **no pierde un plato: pierde la llamada entera**. El último salto (1.400 → 1.600) es el **`consume` por ingrediente** (~10 tokens × ~10 ingredientes). Subir el techo **no cuesta nada** (solo se pagan los tokens generados). Si le agregas campos al plato, **vuelve a medir**: `SELECT output_tokens FROM generaciones`.

**Costo medido (Gemini flash, `gemini-2.5-flash`):**

| Operación | Tokens (in / out) | Costo |
|---|---|---|
| **Un día (3 platos: receta + nutrición + `consume`)** | 2.222–2.392 / 1.918–2.304 | **$0.0055–0.0064** |
| Una semana completa = 7 días sueltos | — | **~$0.038–0.045** |
| ~~Un día antes del `consume`~~ (referencia) | 1.823 / 1.825 | $0.0051 |
| Un día sin receta (histórico) | 1.636 / 1.382 | $0.0039 |
| Un plato suelto | ~2.340 / ~530 | ~$0.002 |
| Backfill de 21 platos (`/detallar`) | 3.492 / 3.450 | $0.0097 |
| ~~Menú de 21 platos de un golpe~~ (histórico, ruta eliminada) | 1.568 / 11.523 | $0.029 |

**Generar día a día no salió más caro que la semana de un golpe** (~$0.028 vs $0.029 sin receta). El contexto se repite en cada llamada, pero la entrada de flash es ~8x más barata que la salida, y la salida total es la misma. La intuición de "7 llamadas cuestan 7x" es falsa aquí — **medido, no estimado**. La receta subió el día un **31%** ($0.0039 → $0.0051).

> ### 🔥 El costo real depende de `ai_modo`, y esa tabla es SOLO Gemini
> **Local y producción están en `ai_modo='gemini'`**, así que la tabla de arriba es la que
> aplica hoy en los dos. La de abajo es la comparación del **mismo día** medido con ambos
> proveedores, y sigue valiendo si alguien vuelve a poner Claude desde el admin:
>
> | Proveedor | Tokens (in / out) | Un día | Una semana | vs Gemini |
> |---|---|---|---|---|
> | Gemini flash | 1.823 / 1.825 | $0.0051 | **$0.036** | — |
> | claude-sonnet-5 (lanzamiento, hasta 31-ago-2026) | 4.197 / 1.540 | $0.0202 | **$0.142** | **4,0x** |
> | claude-sonnet-5 (lista, desde 1-sep) | ídem | $0.0303 | $0.212 | 5,9x |
> | claude-opus-4-8 | ídem | $0.0506 | $0.354 | 9,9x |
>
> **Dos cosas se multiplican:** (1) Claude cuenta **2,3x más tokens de entrada por el mismo
> prompt** (4.197 vs 1.823) — su tokenizador es menos eficiente en español; y (2) su salida
> cuesta 4-6x más por token ($10-15/M vs $2.50/M). Las cifras de Claude incluyen el **×0.85
> del grupo "Claude Default"** del gateway (ver `.env.example`: el grupo es un multiplicador
> de precio, no un modelo).
>
> ⚠️ **Al comparar mediciones, mira SIEMPRE la columna `proveedor`.** Aplicarle la tarifa de
> Gemini a una fila de Claude da un costo ~7x optimista: ya me pasó, y de ahí salió un "×7"
> que estuvo un tiempo en este archivo (era sonnet-4-6 a precio de lista y sin el ×0.85 del
> grupo). **Si cambias de modelo o de grupo, recalcula** — no arrastres el múltiplo viejo.
>
> En la práctica se vio **caer a Gemini solo** (`[IA] fallo claude: ...JSON`): el gateway
> devuelve JSON malformado a ratos y el fallback salvaba la llamada. ⚠️ **Con el
> `ai_modo='gemini'` de hoy ese fallback ya no existe**: si Gemini falla, la llamada devuelve
> 502. Es el precio de no pagar 4x — pero tenlo presente antes de diagnosticar un 502 raro.

### El cupo de generaciones — cómo y por qué
- **1 generación = 1 llamada a la IA = 1 día (3 platos) o 1 plato suelto.** Cuesta lo mismo pedir 1 que 3: la llamada es la unidad. **Free = 7/semana**, o sea justo una por día para armar la semana completa.
- `cupoAgotado()` se verifica **ANTES** de llamar a la IA (rechaza en ~40 ms): no tiene sentido gastar tokens y luego responder 403.
- El cupo es **por semana del plan** (`generaciones.semana`), no por semana de calendario: cada semana que planificas trae su propio cupo.
- `registrarGeneracion()` anota el gasto **aunque el JSON venga mal**: la IA ya cobró esos tokens.
- Verificado: contando solo `analisis` (como hacía NutriIA), **el 100% del gasto del planificador sería invisible** en el panel.

> ⚠️ **Si cambias la unidad de generación, re-escala `generaciones_max`.** Cuando el menú se
> generaba de un golpe, Free tenía **1** (una llamada rendía los 21 platos). Al pasar al día,
> ese 1 habría dejado al usuario Free con **un solo día** y el resto de la semana bloqueada.
> Ojo con la trampa: el seed de `planes` es `INSERT OR IGNORE` con `nombre` UNIQUE, así que
> **cambiar el número en el seed no toca una BD ya creada** — hace falta la migración
> explícita (`UPDATE ... WHERE nombre='Free' AND generaciones_max = 1`, que solo pisa el
> valor viejo exacto para no aplastar lo que el admin haya configurado a propósito).

### Verificación de platos propuestos — ✅ hecha (2026-07-16)
`verificarPlatos(ctxTexto, pedidos[])` + **`POST /api/plan/verificar`** (`tipo='verificar'`) — **una sola llamada en batch** (de 1 a 21 platos; 21 llamadas sueltas serían absurdamente caras). Devuelve por plato: ingredientes escalados a los comensales, **cobertura** (tengo / falta), **veredicto** (`alcanza` | `alcanza_justo` | `falta_comprar`) y **advertencias médicas**. El plato nace con `origen='propuesto'`, y la cobertura va a `plan_comidas.cobertura` + `verificado_en`.

- **La IA informa, NO sustituye.** Si el plato que pidió la familia lleva un alérgeno, el prompt le prohíbe cambiarlo por otro "que le convenga": lo devuelve tal cual y lo dice en `advertencias`. La familia decide. Medido con el hogar de prueba (alérgico al maní), pidiendo "pollo con salsa de maní": *"¡ALERTA DE ALERGIA! Este plato contiene maní, al cual **Luis** es alérgico. No debe consumirlo bajo ninguna circunstancia."* — nombra al integrante concreto.
- **`reconocido: false`** → HTTP **422** con `no_reconocidos`. La UI se queda en el modal para que el usuario corrija en vez de inventarse un plato con un texto sin sentido.
- El nombre se guarda **normalizado por la IA** ("aji d gallina" → "Ají de gallina"), con el del usuario como respaldo.
- ⚠️ **El tope de longitud de `advertencias` es 400, no 80.** `listaTexto()` trunca a 80 porque sirve para nombres de ingredientes; aplicado a una advertencia la cortaba **a media palabra** (*"…alergeno absoluto para L"*) — justo el mensaje que no se puede recortar. Lo cubre `smoke:plan`.
- Costo medido (1 plato, Claude): 4.549 in / 1.894 out. **Latencia alta: ~40s con 1 plato y hasta ~190s con 2** — la respuesta trae receta + nutrición + cobertura + advertencias. La UI anuncia "hasta un minuto".

> **El emparejamiento ingrediente↔despensa lo hace la IA, no un `LIKE` en SQL.** Ya le mandamos la despensa en el mismo prompt, y sabe que "pechuga" cubre "pollo", que "chuño" es papa seca y que "ají amarillo" no es "ají panca".
>
> **Validado en la práctica:** con "Arroz" y "Leche" en la despensa, la IA marcó **"arroz integral"** y **"leche sin lactosa"** como *faltantes* — porque el arroz blanco no sirve para la diabetes de un integrante y la leche normal no sirve para el intolerante a la lactosa. Un `LIKE` habría dicho "ya lo tienes" y le habría servido leche a quien no puede tomarla.

> ⚠️ **Gemini y Claude NO responden igual al mismo prompt.** Con `ai_modo='ambos'` el fallback tapa la diferencia y un bug puede vivir meses escondido: el de las etiquetas `dia`/`momento` (arriba) solo aparecía cuando Claude atendía de verdad. **Al tocar un prompt del planificador, pruébalo con los dos proveedores** (`setConfig('ai_modo','gemini')` / `'claude'`), no solo con el que te toque ese día.

### Prompts del planificador (`ai.service.js`)
- **`REGLAS_PLANIFICADOR`** son las reglas duras y las hereda todo prompt que proponga platos. Si se duplicaran, un flujo podría "olvidar" una alergia que otro sí respetaba.
- **`contexto.js` es la fuente única** del contexto que ve la IA. Cada flujo (generar, detallar, verificar) debe usar `contextoDe()` + `textoContexto()`: si cada ruta armara el suyo, una podría omitir las alergias.
- **El contexto lleva el PERIODO (`hogar.semanas`) y define el 100% de la despensa** en el mismo bloque: *"«queda» es el % … medido sobre lo que necesita para el periodo completo de N semana(s)"*. Sin ese dato, `queda 50%` no le dice a la IA si le sobra media semana o dos meses, y el `consume` que devuelve no tendría contra qué calibrarse.
- **`textoContexto()` inyecta también las instrucciones generales del admin** (`config.ia_instrucciones`) al final del bloque de contexto, así que valen para **todos** los flujos con solo escribirlas una vez. Son **globales** (no por hogar) y el propio texto deja explícito que **nunca** pisan una alergia ni una condición médica — esas siempre mandan, para que una instrucción del admin no pueda bajar esa protección. Vacío = no se añade nada.
- Las **alergias se repiten aparte** en el prompt (aunque ya vayan dentro de `integrantes`) para que la restricción dura sea imposible de pasar por alto.
- Auditoría de una generación real (hogar con diabetes + hipertensión + intolerancia a la lactosa, alergias a maní y mariscos): **0 alérgenos, 21/21 platos usando la despensa, 0 repetidos, 21/21 con nota de adaptación**, y distinguió correctamente que "mariscos" no excluye pescado (propuso trucha).

### Condiciones médicas — responsabilidad real
Las **alergias** son exclusión **absoluta** en el prompt (nunca "preferencia"). Las **condiciones** (diabetes, hipertensión…) adaptan el plato y generan advertencias. Una alergia mal manejada no es un mal consejo, es un daño: al tocar los prompts, no bajes esa restricción.

### Flujo de pago Yape + vencimiento
Usuario sube comprobante (`numero_operacion` único, un pago pendiente a la vez) → `pendiente` → admin aprueba → transacción asigna el plan, **reinicia `analisis_restantes`** y fija `plan_expira` = hoy + `dias_vigencia` (si renueva antes de vencer, extiende desde la fecha vigente). Al vencer, `usuarioPublico` **degrada a Free** en el siguiente acceso (perezoso, sin cron).
- **Aprobar/rechazar usan el modal propio `confirmar()`**, no el `confirm()` nativo (2026-07-16). El de aprobar **pregunta si ya se verificó el Yape** antes de activar el plan — la aprobación es irreversible (asigna plan y reinicia cupos), así que la fricción es a propósito. El input del QR de Yape está en español ("Seleccionar imagen…", input nativo oculto tras un `<label>`).

### Dashboard de inicio (`inicio.routes.js` + `inicio.html`) — 2026-08-21
Es la pantalla de aterrizaje tras el login (antes se caia directo al escáner). Muestra saludo por hora, **las comidas de hoy con su fecha**, el plan actual, el periodo de compra y 8 tarjetas de estadísticas.
- **Una sola llamada** (`GET /api/inicio`) devuelve todo. Armarlo desde el cliente serían **cuatro** peticiones en la pantalla que más se abre, y cada una trae cargas completas (todos los platos, toda la despensa) para acabar mostrando un número.
- **No usa IA ni consume cupo:** son conteos sobre datos que ya están en la BD.
- `fechaCasilla` repite el criterio de `plan.routes.js` (`DIA_NUM`, domingo = séptimo día). Si aquí se calculara distinto, el dashboard mostraría como "hoy" los platos de otro día.
- El **consumo de la despensa** se mide como `100 − promedio(porcentaje)`, coherente con que el 100% significa *"tengo todo lo que el plan necesita para el periodo"*.
- El **uso de IA suma las dos fuentes** (`generaciones` y `analisis`), como el panel admin: contar solo una dejaría fuera la mitad del gasto.
- El saludo usa la hora de **Perú**, no la del navegador: un reloj en otra zona daría "buenas noches" a media mañana.
- Una comida sin planificar **se muestra** invitando a llenarla; esconderla haría creer que el día está completo.
- Lo cubre `npm run smoke:inicio`, que además **cruza los conteos con `/api/despensa` y `/api/hogar`**: si el dashboard contara por su cuenta, dos pantallas dirían números distintos de lo mismo.

### Barra inferior en móvil (`api.js`) — 2026-08-21
Cinco secciones (Inicio, Analizar, Plan, Despensa, Platos) fijas abajo, como en NutriIA. En el teléfono el sidebar está tras el botón de menú, así que navegar costaba dos toques.
- **No se pinta para el admin** (su navegación es otra y no cabe en cinco iconos) ni en login/registro.
- Las tres del planificador solo aparecen si el plan lo incluye: un enlace que lleva a un 403 es peor que no tenerlo.
- ⚠️ **Entra exactamente en el mismo breakpoint en que se esconde el sidebar (760px).** Si entrara antes (860, como en NutriIA) habría un tramo con **las dos navegaciones a la vez**. El `.main` reserva 76px abajo o la barra tapa el final del contenido.

### Perfil del usuario (modal en `api.js`) — 2026-08-21
Se abre pulsando el nombre en el sidebar y permite cambiar nombre, email, **foto** y contraseña.
- Es un **modal y no una página**: se alcanza desde cualquier pantalla, y sacarlo a `/perfil.html` obligaría a abandonar lo que se estaba haciendo.
- **La foto se guarda como data URL en `usuarios.foto`**, no como archivo en disco: el navegador la comprime a 256px (~15-40 KB) antes de enviarla, así no hay subida de archivos, ni `/uploads` que servir, ni huérfanos que limpiar. El backend valida el prefijo `data:image/...` y **topa el tamaño en 400 KB** — sin ese tope, cualquiera metería megas de base64 en una fila que además se respalda entera en cada despliegue.
- ⚠️ **`usuarioPublico` tiene una lista EXPLÍCITA de columnas**: al añadir `foto` hubo que agregarla también al `SELECT`, o la ruta guardaba bien y devolvía `null`. Ya me pasó. Si añades una columna de usuario que el front deba ver, tócalo en los dos sitios.
- **Cambiar la contraseña exige la actual** aunque la sesión esté abierta: si alguien deja el navegador abierto, no debería poder cambiarla y dejar fuera al dueño de la cuenta.
- En jsdom hay que **doblar `canvas`** (`getContext`/`toDataURL`): no lo implementa, y la compresión de la foto lo toca al cargar.

### Plan de comidas: legibilidad (2026-08-21)
- **Desayuno / Almuerzo / Cena** pasaron de 11px en mayúsculas y gris a 14px, sin `text-transform` (que penaliza la lectura) y con el emoji aparte a 22px (`.mom-ic`).
- **Un día sin ningún plato** lleva `.sin-programar`: **fondo sólido más oscuro** (`#dbe7d6`). Antes todos eran blancos y había que leer el contador `0/3` para saber cuáles faltaban. Sobre ese fondo las casillas vacías se aclaran, o se difuminarían en él. Si además es **hoy**, se repite el borde verde: `.sin-programar` va después de `.dia-fila.hoy` y tiene la **misma especificidad**, así que sin esa regla el realce del día actual se perdería.

### Revision de MOVIL (npm run movil) — 2026-08-23
jsdom **no calcula layout** (los rect dan cero y los media queries no se evaluan contra un ancho real), asi que los smokes no pueden decir si algo *se ve* bien. `pruebas/revisar-movil.js` abre las paginas en **Chrome headless por CDP** con viewport de telefono (390x844, touch) y mide lo que de verdad rompe: desborde horizontal, elementos fuera del ancho, areas de toque menores de 32px, texto por debajo de 11,5px y si el `.main` reserva el alto de la barra inferior. Deja capturas PNG que se pueden mirar.
- **Hallazgos reales de la primera pasada** (todos corregidos): la **mascota tapaba botones** en movil (el Quitar de cada producto y las acciones de cada casilla), los botones de la casilla median **23px de alto**, el slider de stock **18px**, y **7 de los 81 emojis** del mapa de iconos **no tenian glifo en Windows 10** y salian como cuadro vacio.
- ⚠️ **Los emojis nuevos (Unicode 13-15) no estan en todos los sistemas.** El de las legumbres (🫘) lo usaban **19 ingredientes**: toda la categoria salia con un rectangulo. Antes de meter un emoji al mapa, pasa el detector: dibuja cada uno en un canvas y lo compara con el tofu de un codepoint sin asignar. Un icono que no existe es **peor** que no poner icono.
- **La mascota se oculta en móvil** (`display:none` a ≤760px). Es fija y decorativa, y en 390px se comía la esquina inferior derecha; además, al necesitar `pointer-events:auto` para poder arrastrarla, **se comía el toque** de lo que tapaba. En escritorio sigue igual.
- Las areas de toque se agrandan **solo en movil**: en escritorio, con raton, lo compacto esta bien y caben mas platos en pantalla.

## Convenciones

- **Idioma:** todo en **español**; identificadores ASCII sin tildes.
- **Errores:** `res.status(XXX).json({ error })`. Códigos: **402** paywall, **403** upgrade, **502** fallo IA, **409** conflicto.
- **Auth:** `requiereAuth` adjunta `req.usuario` (vía `usuarioPublico`, fresco de BD). Admin: `router.use(requiereAuth, requiereAdmin)`.
- **Frontend:** helpers en `public/js/api.js` (`Sesion`, `api()`, `exigirSesion()`, `pintarSidebar()`, `confirmar()`, `CAT_INFO`/`chipCategoria()`, `MOMENTO_INFO`). Token en `localStorage` (`nutrichefia_token`/`nutrichefia_user`).
- **Nombres en la UI:** "**Mi suscripción**" = pagos (`mi-plan.html`). "**Plan de comidas**" = el calendario (`plan.html`). No llamar "plan" a los dos.
- **Fuente única de categorías:** `CATEGORIAS_ING` en `db.js` y `CAT_INFO` en `api.js` deben coincidir.
- **Iconos (2026-08-21):** `iconoIngrediente(nombre, categoria)` e `iconoPlato(nombre, momento)` viven en `api.js` y los usan la despensa, "Mis platos" y el detalle del plato. El icono se **deriva del nombre**, el usuario no elige nada — misma filosofía que la categoría automática de la despensa.
  - ⚠️ **El emparejamiento es por PALABRA COMPLETA, no por substring**, por la misma razón que en `services/consumo.js`: `"sal"` está dentro de `"salsa de soya"` y `"papa"` dentro de `"papaya"`. Con substring, la salsa saldría con el icono de la sal. Las palabras se recorren **en orden** y gana la primera con icono, así `"caldo de pollo"` sale como caldo y no como pollo.
  - La lista salió de **inventariar los ingredientes reales** (51 del catálogo + 162 distintos en los platos de producción), no de imaginarlos. Cobertura medida: **51/51 del catálogo**. Lo que no se reconoce cae al icono de **su categoría**, que nunca falla.
  - `ICONO_FRASE` es para lo que la primera palabra no describe (`"aceite de oliva"` → 🫒 y no 🫙). Si un icono resulta engañoso, es mejor **quitarlo** y dejar el de la categoría: la beterraga estuvo saliendo con icono de tomate (rojo y redondo, pero no es un tomate) y se retiró por eso.
- **Avatar de los integrantes (2026-08-21):** `integrantes.avatar` es un **emoji** (TEXT, migración idempotente en `db.js`), elegido de `AVATARES` con el picker de `hogar.html` y pintado grande con `.avatar-fam` junto al nombre. Es emoji y no foto **a propósito**: sin subida de archivos, sin almacenamiento y sin moderación de imágenes.
  - El tope es de **8 caracteres, no 1-2**: un emoji compuesto (una familia, un tono de piel) son varios puntos de código unidos con ZWJ, y cortarlo por la mitad deja un símbolo roto.
  - Las filas creadas antes de la columna tienen `NULL` y el default se aplica **al leerlas** (`integrantesDe`), no rellenando la tabla: no se reescriben datos que el usuario no ha tocado.
- **Mascota arrastrable y ocultable (2026-08-21, portado de NutriIA):** `api.js` envuelve `img.mascota` en `.mascota-caja`, le añade el botón de cerrar y el arrastre con **pointer events** (vale igual para ratón y dedo). La preferencia (posición y si está oculta) va a `localStorage` — **por dispositivo, no por cuenta**: donde estorba es en el teléfono, y guardarlo en el servidor obligaría a sincronizar algo que no lo necesita.
  - `touch-action: none` en `.mascota-caja` es **imprescindible**: sin eso el navegador del móvil interpreta el arrastre como scroll y la mascota no se mueve.
- **Modal de espera de la IA (`modalCargando()` en `api.js`, 2026-08-21):** generar un día lo abre a pantalla completa con el chef animado, el título grande, una barra indeterminada, **mensajes que rotan** cada 3,5 s y los segundos transcurridos.
  - El aviso vivía en la etiqueta del botón, que mide 11px y solo cabe `✨…`: el usuario se quedaba esperando sin señales claras y creía que la app se había colgado (ya pasó una vez).
  - **No se puede cerrar** — ni con cruz, ni pulsando el fondo. La llamada ya está en vuelo y cerrarlo no la cancelaría: solo dejaría al usuario creyendo que abortó algo que sigue corriendo y le va a cambiar el calendario debajo.
  - La barra es **indeterminada a propósito**: la IA responde de una vez, así que fingir un porcentaje sería mentir.
  - Los mensajes rotan porque en una espera larga un texto quieto se lee como *"esto se colgó"*. Respeta `prefers-reduced-motion`.
  - ⚠️ **Se cierra en el `finally`**, también cuando la IA falla: si quedara abierto tras un 502, la pantalla se quedaría bloqueada sin decir por qué.
- **Modales (`.modal` en `style.css`):** son `max-height:90vh` + columna flex con el `.modal-body` scrolleable — la cabecera (`h3`) y la fila de botones (`.row`) quedan **siempre visibles**. Antes, en PC, un modal alto (detalle del plato, form) se salía de pantalla y ocultaba los botones. Todo modal debe seguir el patrón `h3 + .modal-body + .row` para heredar esto; el contenido largo va **dentro** de `.modal-body`.

## Configuración (.env)

`.env.example` lista las claves. Importante:
- `PORT=3002` (local), `JWT_SECRET`, datos Yape, admin, `ANALISIS_FREE`.
- `AI_PROVIDER` (fallback si no hay `ai_modo` en BD) + `GEMINI_API_KEY`/`GEMINI_MODEL` y `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL`.
- El `.env` está gitignored — **nunca commitear keys**.

## Cómo verificar un cambio

Backend y frontend son **el mismo proceso**: `npm run dev` y abrir `http://localhost:3002`.

1. **API** → `curl` contra `:3002`. Login rápido:
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/login -H "Content-Type: application/json" \
     -d '{"email":"fam@test.pe","password":"prueba123"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
   curl -s http://localhost:3002/api/plan -H "Authorization: Bearer $TOKEN"
   ```
2. **Páginas** → `npm run smoke`. Que el JS *parsee* no dice nada: estas páginas hacen
   todo su trabajo en runtime. jsdom las carga de verdad y reporta errores de consola.
3. **Layout/CSS** → jsdom **no** los valida. Para eso, el navegador.

> Al escribir un smoke test nuevo: **debe limpiar lo que crea** y **no debe depender de la
> corrida anterior** (fijar el estado al empezar o usar nombres únicos). Ambos errores ya
> me costaron falsos negativos.
>
> **Y tampoco debe depender de la FECHA en que se corra** (2026-08-21). El aserto del
> checklist de compra daba por hecho que la ventana por defecto no pisaba ninguna semana con
> platos, y eso dejó de ser cierto solo por pasar el tiempo: el periodo por defecto alcanzó la
> semana sembrada, aparecieron 2 faltantes (`●`) y el conteo exacto falló **sin que nadie
> tocara la app**. Ahora el número esperado se **calcula** (despensa + faltantes de esa
> ventana) en vez de fijarse. En la misma línea, el test fija `hogar.semanas` al empezar:
> es una preferencia **sticky** que se queda con el valor de la última compra registrada por
> cualquier prueba, así que heredarla cambiaba el tamaño de la ventana entre corridas.
>
> **Limpiar al final NO alcanza:** si la corrida se cae a medias, deja basura que hace
> fallar la SIGUIENTE con un error que no tiene nada que ver con lo que se prueba (a
> `smoke:plan` le quedó un plato en la semana de prueba y la siguiente corrida falló con
> "la semana no está vacía"). Por eso `smoke:plan` **vacía la semana de prueba al empezar**
> y al terminar. Fija el estado, no lo heredes.

### Trampas que ya me mordieron
- **`npm start` no recarga.** Probé rutas nuevas contra el proceso viejo y recibí 404s fantasma. Usa `npm run dev`.
- **jsdom + `navigator.serviceWorker = undefined`** rompe `api.js`: el guard es `'serviceWorker' in navigator`, y asignar `undefined` lo hace pasar. **No toques esa propiedad** en los tests.
- **`body.textContent` en jsdom incluye el código de los `<script>` del body.** Como estas páginas llevan su JS inline, un aserto tipo `/texto viejo/.test(doc.body.textContent)` hace match contra los **comentarios del fuente** y falla aunque la UI ya diga lo correcto. Ya me dio dos falsos negativos. Clona el body y quita los `<script>` antes de buscar texto visible.
- **`creado_en` es `datetime('now')`: precisión de SEGUNDOS.** Un test que crea varias filas de golpe las deja **todas con el mismo timestamp**, así que `ORDER BY creado_en DESC` queda empatado y el "primero" es arbitrario entre corridas. Un smoke que borraba `platos[0]` y luego daba por hecho *qué* plato había borrado pasó **en falso** (el aserto "un plato de almuerzo no se ofrece" se cumplía porque el de almuerzo ya no existía). Si tu prueba depende de un plato concreto, **fija el estado tú mismo**; no heredes el que dejó la sección de arriba.
- **Basura en la despensa = basura en el menú.** La IA usa lo que encuentre; un ingrediente de prueba olvidado genera platos reales alrededor de él.
- **El atributo `hidden` lo pisa cualquier clase con `display`.** `.btn` es `inline-flex`,
  asi que un boton con `hidden` **se seguia viendo** ("Quitar filtros" salia sin filtros
  puestos, y la barra de paginacion con una sola pagina). El UA lo declara con especificidad 0.
  Ahora `[hidden] { display: none !important; }` esta junto a `.hidden` en `style.css`.
- **`sed` puede fallar en silencio.** Si editas con `sed`, verifica el resultado: di por hecho que un bloque se había insertado y no era así.

## POR DÓNDE SEGUIR (última sesión: 2026-08-25 · fases 1-5 hechas · **EN PRODUCCIÓN**)

> **La app es pública:** https://nutrichefia.solucionesctec.com. Cualquier cambio que subas a
> `main` y despliegues lo ven usuarios reales. Redeploy y trampas: `DEPLOY.md`.
>
> **Quedan 2 cosas de operación pendientes** (ver Deuda): el titular de Yape es un
> placeholder (nadie puede pagarte); y la key de Gemini es **compartida con MedicaIA y
> NutriIA**, las tres en producción. La contraseña del admin **ya se cambió** (2026-07-29).
>
> **Lo siguiente en producto es la fase 6** (pulir la UI del admin). La fase 5 (compra por
> periodo + lista de faltantes + PDF) se cerró el 2026-07-18. Del rebranding solo falta el
> arte propio del chef del semáforo.
>
> ### Lo que entró el 2026-08-25 (todo desplegado y verificado)
>
> | Qué | Dónde está documentado |
> |---|---|
> | **Análisis de consumo** (nueva sección + `/api/nutricion`) | "Analisis de consumo" |
> | **Vaciar la semana** del calendario | "Vaciar la semana" |
> | Las **peticiones del hogar** (`hogar.notas`) pasan a ser obligatorias en el prompt | "Las PETICIONES de la familia" |
> | "Mis platos" → **"Mis Recetas"**, con **filtros y paginación** | dos secciones con ese nombre |
> | Explicación **por nutriente** al tocarlo, sin IA | "Que significa cada nutriente" |
> | Las **instrucciones** del plan, arriba y en amarillo | "Las instrucciones del plan…" |
> | "Mis compras": **todo desmarcado** + **subtotal por pasillo** | "Mis compras: todo desmarcado…" |
> | **Una sola cabecera** (`.hero-seccion`) en las diez pantallas | "Una sola cabecera…" |
> | El **favicon** con fondo transparente + `scripts/recortar-fondo.js` | "Rebranding" en Deuda |
> | Dos arreglos de **móvil**: la fila de campos y la lista de productos | sus dos secciones |
>
> **Y tres mejoras en `npm run movil`**, que es lo que hace que estas cosas no vuelvan a pasar:
> abre los acordeones antes de medir (antes revisaba listas invisibles), detecta **texto
> aplastado** y **filas de campos torcidas**. Las tres se verificaron **rompiendo el CSS a
> propósito** para comprobar que fallan cuando deben.
>
> **Pruebas gratis que hay ahora:** `smoke`, `smoke:platos`, `smoke:inicio`, `smoke:compras`,
> `smoke:analisis` y `movil`. Todas en verde al cerrar la sesión.
>
> ### Lo que NO se ha probado y conviene mirar
> - **El informe del análisis con un hogar cuyos platos tengan los 7 nutrientes.** Se probó con
>   platos en formato viejo (solo calorías), que es el caso más común hoy, y con datos sembrados.
> - **Nada de esto se ha probado con Claude** (`ai_modo='claude'`), incluida la regla 9 de las
>   peticiones. Es la advertencia de siempre: el fallback tapa las diferencias entre proveedores
>   y ahí ya se escondió un bug meses.
> - **El coste real del análisis**: una llamada medida en ~9 s con Gemini, sin apuntar los tokens.
>
> ✅ **El consumo de la despensa (2026-07-27) está verificado con IA real (Gemini).** Devuelve
> `consume` en **11/11 ingredientes** y con criterio: `Pollo 80, Papa 40, Ajo 5, Sal 2,
> Comino 2` — distingue lo que se acaba en el plato de lo que dura meses, que es justo lo
> que la heurística por categoría no puede hacer. **Falta probarlo con Claude**
> (`setConfig('ai_modo','claude')` + `npm run smoke:plan`, ~$0.047): el fallback tapa las
> diferencias entre proveedores y ahí ya se escondió un bug meses.
>
> 🔴 **Sesión 2026-07-29 — EL 100% CAMBIÓ DE SIGNIFICADO.** Era "el envase lleno" y ahora es
> **"lo que necesitas para el periodo"**. Salió de una pregunta del usuario (*"100% significa
> que compré todo el arroz que se necesita para el periodo?"*) que dejó ver que la referencia
> vieja no estaba atada a nada. Con la nueva el modelo **cierra**: una semana de platos consume
> una semana de necesidad. Lee el punto rojo de "Consumo de la despensa" **antes** de tocar
> `PESO_CATEGORIA`, `totalizar()` o `FORMATO_CONSUME` — el ancla, la fórmula de acumulación y
> los pesos por categoría **son un solo diseño**, no tres cosas sueltas.
>
> En la misma sesión: el `consume` se pide también en el **backfill de `/detallar`** (único
> camino por el que un plato ya existente puede conseguirlo) y **cada producto de la compra dice
> cuánto se compró** con su propia barra.
>
> **Lo que NO se probó:** el ancla nueva con **Claude** (solo con Gemini; misma advertencia de
> arriba, y ahí ya se escondió un bug meses), el backfill de una semana de 21 platos de un tirón,
> y el ciclo completo *comprar → cocinar los 21 platos → ¿queda todo cerca de 0?*, que es la
> comprobación que cierra el modelo. **El ancla nueva ya está desplegada** desde entonces, y la
> migración (`config.consume_escala`) borró el `consume` de los platos que existían: los usuarios
> vieron reaparecer el botón de completar recetas, que es lo esperado.

> **La fase 4 se cerró el 2026-07-16.** El calendario tuvo entonces **tres vías** para llenar una
> casilla: *"✨ Proponer"*, *"✍️ Ya sé qué cocinar"* y *"📋 Mis platos"*.
> ⚠️ **Desde el 2026-08-25 quedan DOS**: *"✍️ Ya sé qué cocinar"* se retiró del calendario y esa
> forma de crear vive ahora en **Mis Recetas**, que es donde el plato queda guardado para
> reutilizarlo (ver "La biblioteca va SIEMPRE primero"). El botón del modal tampoco se llama ya
> "Guardar en mi biblioteca", sino **"Guardar en Mis Recetas"**.

> **Cambio de modelo (2026-07-15):** la generación pasó de **la semana de un golpe** al
> **día a la carta**. Se eliminó la ruta que armaba los 21 platos, `POST /generar` ahora
> recibe casillas, el Free pasó de 1 a **7 generaciones/semana** y cada día del calendario
> tiene su botón. Detalles en "Plan de comidas" y "El cupo de generaciones".

### Fase 4 — ✅ CERRADA (2026-07-16). Lo cubren `smoke:plan` y `smoke:platos`.

1. **Pasos de preparación** — ✅ **hecho** (2026-07-15). `npm run smoke:plan` lo verifica.
   - El plato **nace con su receta**: `FORMATO_PASOS` va dentro de `FORMATO_PLATO`, así que
     `generarPlatos` la trae en la misma llamada (ver "El plato nace COMPLETO"). El modal
     `verPlato()` la pinta en un `<ol>`.
   - `POST /api/plan/detallar` quedó como **backfill** de los platos viejos (`pasos`/`info` en
     NULL), y el botón del calendario es **"🍳 Completar recetas (N)"** (se llamaba "Completar
     platos" y nadie sabía qué completaba), que solo aparece si hay alguno incompleto.
   - `normPasos()` (en `plan.routes.js`) **le quita la numeración manual** a cada paso: la IA
     escribe "1. Sancochar…" pese a que el prompt se lo prohíbe, y el `<ol>` ya numera —
     salía "1. 1. Sancochar el pollo".

2. **Biblioteca de platos** (`platos.html` + `/api/platos`) — ✅ **hecha**. `npm run smoke:platos`.
   - CRUD de platos manuales (`origen='manual'`, `guardado=1`) desde la página. El tope
     `platos_max` se aplica **al crear/guardar** (403 `{upgrade}`), no al editar.
   - Los campos de **ingrediente** del form se **autocompletan desde la despensa** (2026-07-16):
     un `<datalist>` que `platos.html` llena con `GET /api/despensa` (despensa + catálogo,
     deduplicados) — se puede elegir uno que ya se tiene o **teclear uno nuevo**. Si el plan
     no incluye planificador (403), degrada sin ruido a texto libre.
   - **"☆ Guardar en mi biblioteca"** en el modal `verPlato()` del calendario — ✅ **hecho**
     (2026-07-16). Llama a `POST/DELETE /api/platos/:id/guardar`. Es la vía por la que el
     usuario **cura** lo que le gustó: un plato generado que sale del calendario y no está
     guardado **se borra** (`limpiarPlatoHuerfano`).
   - Poner un plato de la biblioteca en una casilla — ✅ **hecho** (2026-07-15). La casilla
     vacía ofrece **"📋 Mis platos"** junto a "✨ Proponer": abre un selector
     (`elegirDeBiblioteca()` en `plan.html`) que filtra por el momento de la casilla —
     **un plato sin `momento` encaja en cualquiera** — con interruptor "Ver todos" y
     buscador, y llama al `POST /api/plan` que ya existía. **No consume cupo ni pasa por
     `bloqueoGen()`**: no llama a la IA, así que funciona incluso sin hogar configurado.
     Lo cubre `npm run smoke:platos` (gratis).
   - Borrar un plato lo saca del calendario (`plan_comidas.plato_id` es **ON DELETE CASCADE**).
     La página avisa antes mostrando `en_plan`; no lo hagas en silencio.
   - `limpiarPlatoHuerfano()` ya respeta `guardado=1`: no borres esa lógica. `DELETE /:id/guardar`
     replica esa misma regla (si lo generó la IA y no está en ningún plan, se borra).

3. **Verificar platos propuestos** — ✅ **hecho** (2026-07-16). El detalle está en
   "Verificación de platos propuestos" arriba. La casilla vacía ya ofrece **las tres vías**:
   *"✨ Proponer"* (la IA elige), *"✍️ Ya sé qué cocinar"* (`verificarPlato()` → 
   `POST /api/plan/verificar`) y *"📋 Mis platos"*. El modal pinta la cobertura con
   `bloqueCobertura()`, y **las advertencias van primero y en rojo**: pueden decir que el
   plato lleva un alérgeno del hogar, y es lo más importante de esa pantalla.

### Fase 5 — compra por periodo + lista de faltantes + PDF — ✅ HECHA (2026-07-18)
Cierra la promesa: *"los faltantes de ambas direcciones se consolidan en **una sola lista de
compras**"* (ver "La inversión conceptual"). Lo cubren `smoke:platos` (forma del endpoint,
gratis) y `smoke:plan` (dedup con datos reales, con IA).

**`GET /api/plan/faltantes?inicio=&fin=` | `?compra_id=` | `?semana=`** (en `plan.routes.js`).
Sin parámetros: la semana actual. La ventana puede **cruzar varias semanas ISO** (para una
cadencia mensual): filtra las casillas por su **fecha real** (`fechaCasilla` = `semana` + el
offset del día vía `DIA_NUM`). Une las dos fuentes:

1. **`platos.faltantes`** — lo que la IA marcó al generar (fuente `generado`).
2. **`plan_comidas.cobertura.faltantes`** — lo que arrojó *verificar* un plato propuesto (fuente `propuesto`).

- **Dice CUÁNTO comprar de cada faltante (2026-07-30).** Cada ítem trae **`medida`** (texto listo para pintar: *"3 unidades"*, *"12 rebanadas"*, *"500 g + 2 tazas"*) y **`cantidades[]`** (el desglose `{unidad, cantidad}`). La lista pasó de *"manzana"* a *"manzana — 3 unidades"*.
  - **No cuesta nada: las cantidades YA estaban** en `platos.ingredientes` (la IA devuelve `cantidad` + `unidad` por ingrediente) y esta ruta las tiraba, porque los faltantes son solo **nombres**. Se cruzan con los ingredientes del mismo plato por `claveIng`. Sin IA, sin campos nuevos, sin que el usuario escriba nada.
  - **Se suma solo DENTRO de la misma unidad.** `UNIDAD_CANON` unifica lo que es la misma medida escrita distinto (`g`/`gramos`, `ramita`/`rama`, `manojo`/`atado`) y `TAMANOS` descarta el calificativo de tamaño que mete la IA (*"unidad mediana"*). **Nunca convierte entre medidas distintas:** una taza de arroz pesa ~185 g y una de harina ~120, así que `taza → g` necesitaría una tabla **por ingrediente** y equivocarse ahí sería un error silencioso en la cara del usuario. Si un ingrediente viene en dos unidades se muestran las dos (*"500 g + 2 tazas"*). La **única** conversión permitida es `g→kg` y `ml→l` a partir de 1000: factor exacto y es como habla la gente.
  - **Los plurales van explícitos en `UNIDAD_PLURAL`, no por `claveIng`:** su singular es "simple" y convierte `dientes` en `dient` (no en `diente`) — justo el caso de media receta peruana. Para nombres de ingrediente da igual (compara clave contra clave); para unidades, no. Los símbolos (`g`, `kg`, `ml`, `l`) no se pluralizan nunca.
  - **Una cantidad ausente no cuenta como 0.** Los platos manuales pueden no traerla: esa aparición no suma y las demás sí. Fingir un 0 daría un total **más bajo que la verdad** y el usuario compraría de menos; si ningún plato la trae, `medida` es `null` y la UI simplemente no muestra número.
  - Medido sobre la semana real del hogar de prueba: `manzana 2+1 = 3 unidades`, `pan integral 4+4+4 = 12 rebanadas`, `palta 0.5+1 = 1.5 unidades`, `sal 0.5+0.25+0.5 = 1.25 cucharaditas`, `yuca 1 kg`. 18 de 18 faltantes con medida. En **producción**, 31/31 y 18/18: `carne 800 g ×2 = 1.6 kg`, `zanahoria 10 unidades` (×6 platos), `arvejas 200 g + 2 tazas` (dos unidades, sin inventar la suma).
  - **`UNIDAD_CANON` se llenó inventariando las unidades que la IA usa DE VERDAD**, no imaginándolas: `SELECT ingredientes FROM platos` en producción dio 30 distintas, y así aparecieron `rodajas` y `porciones`, que faltaban. Si añades campos o cambias de proveedor, **vuelve a inventariarlas** — es una consulta.
  - **`"1 mediana"` es una unidad que es solo el tamaño** (visto en producción). Al quitar el calificativo no queda nada, pero lo que quiso decir es *"1 unidad mediana"*: si el campo venía **no vacío** y se queda vacío al limpiarlo, se asume `unidad`. Un campo vacío **de origen** se respeta vacío — un número suelto no se convierte en piezas por nuestra cuenta.
  - En el **PDF** la cantidad va en negrita pegada al nombre y el *"(en N platos)"* alineado a la derecha en gris: delante del puesto del mercado lo que se lee de un vistazo es el número.
  > **Por qué esto y no kilos en la despensa** (decidido el 2026-07-30): el porcentaje es la escala correcta para lo que hay **en casa** — nadie pesa el aceite que le queda. Pasar la despensa a kilos exigiría una tabla de conversión **por ingrediente** (taza/atado/diente), lidiar con **mermas** (un kilo de pollo con hueso no es un kilo de carne) y, sobre todo, que el usuario **teclee número + unidad para ~30 productos en cada compra** — que es lo que hace que la gente deje de registrar sus compras, y sin compra registrada la app se queda sin entrada. El hueco real no era la despensa: era que la lista de compras no decía cuánto.
- **Deduplicación con `claveIng()`**: minúsculas + sin tildes + espacios colapsados +
  **singular simple** (une "tomate"/"tomates", "Cebolla roja"/"cebolla roja"). El singular
  solo afecta la **clave**, no el nombre mostrado (se conserva el primero visto). Cada ítem
  lleva `casillas` (en cuántos platos aparece) y `fuentes[]`.
- **Agrupada por categoría** cruzando con `ingredientes_catalogo` (mismo `claveIng` en ambos
  lados para tolerar plurales); lo que no matchea cae a `otro`. El orden es el de
  `CATEGORIAS_ING` = **orden de pasillo del mercado** (se usa caminando el mercado, no por plato).
- **NO usa IA** ni consume cupo: son datos que ya están en la BD. La cobertura corrupta se
  ignora sin tumbar la lista.
- **UI en `plan.html`**: botón "🛒 Lista de compras" → modal con los faltantes de la semana
  visible agrupados por pasillo → "⬇ Descargar PDF". El botón **solo aparece si la semana
  visible tiene al menos un plato** (`actualizarBotonFaltantes`): con la semana vacía no hay
  de dónde sacar faltantes, y devolvía una lista vacía que parecía un error ("no me falta
  nada") en vez de "todavía no has planificado". Y un **badge de periodo** (`#badge-periodo`)
  que muestra a qué periodo pertenece la semana visible (*"Despensa del periodo … · semana X de N"*),
  leyendo la última compra registrada; avisa si la semana quedó **fuera** de ese periodo.
- **PDF con `jspdf.umd.min.js`** (vendorizado, viene de NutriIA). Se carga **bajo demanda**
  (al pulsar Descargar), no en cada carga del plan: es pesado y además toca `<canvas>` al
  evaluarse, lo que rompía el smoke en jsdom. Fuentes estándar (helvetica): sin emojis, usa
  `[ ]` como casilla para marcar en el mercado.

### Admin: uso e importe de IA POR USUARIO (2026-08-23)
`GET /api/admin/usuarios?desde=&hasta=` devuelve, por usuario, **cuántas llamadas a la IA hizo** y **cuánto costaron en soles**.
- **Suma las DOS fuentes** (`analisis` + `generaciones`), igual que `/resumen`: contar solo una escondía la mitad del gasto, y aquí el planificador es lo caro (un día ≈ 10 escaneos). La tabla desglosa *"N del planificador · N del escáner"*.
- **El costo se calcula por proveedor**, con las mismas `TARIFAS` del resumen: Claude cuesta ~6x lo que Gemini por token, así que promediar daría una cifra inventada.
- **`config.tipo_cambio`** (soles por dólar, default **3.40**) es editable desde el panel. Las tarifas de los proveedores están en USD y el negocio cobra en soles; sin este número había que convertir a mano. Se guarda con las demás claves numéricas de la config.
- **El rango de fechas se compara en hora de PERÚ** (`date(creado_en, '-5 hours')`). Sin el desfase, todo lo hecho entre las 19:00 y la medianoche caería en el día siguiente y los totales no cuadrarían con lo que ve el usuario. Una fecha con formato inválido **se ignora** en vez de romper la consulta.
- ⚠️ **En la columna de llamadas NO va el símbolo ∞.** Las llamadas *hechas* son siempre un número; lo que sí puede ser ilimitado es el **tope del plan**, y eso vive en la columna de *escaneos restantes* (que dice "ilimitados", no ∞).

### Tres bugs de la despensa opcional y del generar semana (2026-08-25)
Reportados en produccion y corregidos:
- 🔴 **Generar estaba BLOQUEADO para quien no usa despensa.** `POST /api/plan/generar` devolvía 409 *"Tu despensa está vacía"* aunque el módulo estuviera apagado. Quien decidió no llevar inventario **no podía generar NADA**. Ahora ese 409 solo aplica si `ctx.despensaActiva`.
- **`limiteDe is not defined`** en `POST /api/platos/generar`: esa función no existía (la forma del límite se armaba en línea dentro del GET). Se extrajo a `limiteDe()` y la usan los dos sitios, para que el front reciba siempre el mismo objeto. Síntoma: generar un plato con IA desde "Mis platos" se quedaba colgado.
- **Un dia que fallaba tumbaba la semana entera.** La IA devuelve JSON malformado a ratos (visto: *"Expected ',' or ']' at position 1615"*), y el bucle paraba en el primero, dejando los otros seis dias sin intentar. Ahora **continua** y nombra al final los dias que no se pudieron. Solo se para de verdad **si se acaba el cupo**: los intentos siguientes fallarian igual y solo harian esperar.

> **Por que la semana salio "solo con almuerzos":** los 16 platos guardados del usuario eran TODOS de almuerzo, asi que la biblioteca solo pudo cubrir esa fila; desayuno y cena tocaban a la IA, y la primera llamada fallo. Los dos problemas a la vez. Un plato **sin momento** encaja en cualquiera — vale la pena decirselo al usuario al crear platos.

**Costo medido con el aporte nutricional detallado:** un dia (3 platos) paso de ~/usr/bin/bash.0064 a **/usr/bin/bash.0094** (2.822 in / 3.433 out con Gemini), un **+47%**. Es el precio de los 7 nutrientes con %VD y las recomendaciones por integrante.

### La biblioteca va SIEMPRE primero (2026-08-25)
`Proponer`, `Generar día` y `cambiar este plato` hacen lo mismo: **buscan en "Mis platos" y solo llaman a la IA por lo que no encuentren**. Si el usuario ya curó un plato que encaja, usarlo es mejor que inventar otro — es suyo, ya le gustó, y no cuesta una generación.
- El frontend llama a `POST /api/plan/desde-biblioteca` (sin IA ni cupo) y solo pasa a `/generar` los `faltan` que devuelve.
- **`reemplazar: true`** solo cuando la casilla ya tiene plato ("cámbiamelo por otro"): en ese caso el plato actual queda excluido de los candidatos, o devolvería el mismo.
- Si `/desde-biblioteca` falla, **no se corta el flujo**: se sigue con la IA, que es el camino de siempre.

**Se retiró "✍️ Ya sé qué cocinar" del calendario** (y con él `verificarPlato()`, 57 líneas que quedaban muertas): esa forma de crear vive ahora en *Mis platos*, que es donde el plato queda **guardado para reutilizarlo**. En la casilla quedan dos vías: *Proponer* y *Mis platos*.

**No repetir es una regla dura del prompt**, con énfasis en días seguidos y en que cambiar solo el nombre no vale ("pollo al horno" y "pollo asado" son el mismo plato). Al elegir de la biblioteca se excluyen los platos que ya están esa semana.

### Lo que depende de la despensa desaparece si está apagada (2026-08-25)
En cada casilla del plan, con `despensa_activa = 0` **no se pintan**:
- El tag **"✓ tengo todo" / "🛒 falta N"**: compara contra el inventario, y sin inventario no significa nada.
- El botón **"○ marcar como cocinado"**: su único efecto es descontar stock.
- El bloque de **cobertura** del modal "Ver".

### Tres vías para crear un plato en la biblioteca (2026-08-25)
`+ Nuevo plato` ya no abre el formulario: pregunta **cómo** quieres crearlo. Son las mismas tres del calendario a propósito — el usuario ya las conoce de ahí:
1. **A mano** (lo de siempre, sin IA).
2. **Escribo el nombre y lo genera la IA** → reutiliza `verificarPlatos()`, el mismo flujo de *"✍️ Ya sé qué cocinar"*. Es el mismo problema (el usuario dice QUÉ y la IA lo desarrolla) y escribir otro prompt daría recetas con distinto formato para el mismo plato.
3. **Que la IA proponga uno** → `proponerPlatosBiblioteca()`, al que se le mandan los platos que YA tiene para que no los repita. Sin eso, "proponme algo" devuelve por tercera vez el mismo ají de gallina.

`POST /api/platos/generar` los crea con **`guardado=1`**: el sentido es llenar la biblioteca, no ocupar una casilla. Cuesta **una generación** (se cobra contra la semana actual, porque un plato de biblioteca no pertenece a ninguna semana) y **el tope `platos_max` se comprueba ANTES de llamar a la IA**: generar y luego rechazar sería cobrar una generación por nada.

⚠️ **A `proponerPlatosBiblioteca` NO se le manda la despensa**, aunque el hogar la use: un plato de biblioteca es una receta para reutilizar más adelante, no una propuesta para cocinar hoy con lo que queda en casa.

### Generar la semana completa (2026-08-25)
Botón **"✨ Generar la semana"** que pregunta **días** (L–D) y **comidas** (desayuno/almuerzo/cena) antes de nada, y muestra cuántas casillas llenará y cuántas generaciones puede costar.

🔴 **SOLO LLENA LAS CASILLAS VACÍAS.** Ésa es la condición que permitió traer de vuelta este botón: la ruta vieja se eliminó el 2026-07-15 porque **borraba la semana antes de escribir** y destruía los platos elegidos a mano. Si alguien cambia esto, se rompe otra vez lo mismo.

**Primero la biblioteca, después la IA.** `POST /api/plan/desde-biblioteca` coloca los platos guardados que encajen (sin IA y sin cupo; un plato **sin momento** vale para cualquiera, y no repite uno que ya esté esa semana). Lo que quede sin cubrir lo genera la IA.

⚠️ **El bucle de días va en el NAVEGADOR, no en el servidor.** Con Claude de prioridad, 7 días serían ~210 s y **nginx corta a los 180**. Además así se ve el progreso día a día y lo ya generado queda guardado aunque el siguiente falle. Si se queda sin cupo a mitad, **para y cuenta lo que sí quedó hecho**.

### Aporte nutricional detallado (2026-08-25)
`info.nutrientes` trae **valor + % del valor diario** de carbohidratos, proteínas, grasas, fibra, hierro, sodio y equivalente en sal, y se pinta como **barras horizontales** en su propia caja de color.
- **La barra mide el %VD, no el valor absoluto:** son unidades distintas (g y mg) y en la misma escala 581 mg de sodio se vería 20 veces más "grande" que 29 g de proteína.
- **`calorias_vd` se calcula en el backend** (kcal/2000), no se le pide a la IA: es aritmética, y pedirla invita a que devuelva un número incoherente con las calorías que ella misma dio.
- **`info.recomendaciones`** son avisos POR INTEGRANTE (con su nombre) y van **arriba y en su propia caja**: en un hogar con diabetes o hipertensión es lo más importante de esa pantalla, y entre los números no se leen.
- **Sodio y sal se pintan en ámbar sobre el 20% del VD y en rojo sobre el 40%.** El resto no cambia de color: destacar todo es no destacar nada.
- 🔴 **"Le falta la info" NO es solo `info IS NULL`.** Un plato generado antes de este formato tiene `info` con las calorias y las etiquetas alto/medio/bajo pero **sin `nutrientes`**: se daba por completo y nunca conseguia el hierro, la fibra ni el sodio. Reportado como *"solo le agrego calorias"*. Ahora `sinNutrientes()` lo cuenta como incompleto, en el backend **y en el criterio duplicado de `plan.html`** (si no coinciden, el boton no aparece o se queda cobrando por clic).
- Al completarla, la info **se FUSIONA** con la que ya tenia en vez de pisarla: si la IA devuelve los numeros pero se deja el resumen o el semaforo, el plato los perderia. Lo nuevo manda, lo viejo rellena los huecos.
- **Los platos viejos siguen funcionando:** `nutrientes` es opcional y, si no está, se muestran las etiquetas `alto/medio/bajo` de antes. El techo de tokens por casilla subió de **1600 a 2000** por estos campos.

### Mis compras: gasto, precios y presupuesto (2026-08-25)
Pagina propia (compras.html + compras.routes.js). Es OTRA forma de registrar la compra, la que se usa **de pie en el supermercado**: se marca producto por producto, con cantidad y precio.

- **Convive con "Registrar compra" de la despensa**, que es un checklist rapido de lo que trajiste. Esta sirve para otra cosa: **llevar la cuenta del gasto**.
- **Se asocia a la despensa** (lo marcado entra al inventario) **pero el registro se guarda siempre**, tenga el usuario la despensa activa o no: llevar la cuenta de lo que gasta no deberia depender de si lleva inventario. Por eso "Mis compras" tampoco desaparece del menu.
- **La lista sale de `/api/plan/necesidad`**, no de `/faltantes`: en el supermercado uno decide sobre la lista COMPLETA, reponga o no. Arrancan marcados los que faltan (o todos, si no hay despensa).
- **El precio es opcional.** Un texto que no sea numero se guarda como *sin precio*, **no como 0**: un 0 falso ensuciaria el total y el usuario creeria que gasto menos. Por eso el historial avisa cuando hay comprados sin precio — un total bajo puede significar "gaste poco" o "no anote".
- **El total se SUMA de los items, no se guarda.** Los items se pueden corregir despues y un total guardado se quedaria viejo sin que nadie lo note.
- **`compras.presupuesto`**: lo que pensaba gastar esa semana. La barra de totales va **pegada arriba** (sticky) porque es el numero que se mira empujando el carrito, y se pinta en verde mientras quede y en rojo al pasarse.
- **PDF** con el logo, la fecha, el **resumen de platos a preparar** (le da sentido a la lista) y una casilla `[ ]` por producto con su cantidad y un espacio para el precio: se imprime o se mira sin conexion, asi que tiene que servir en papel.

**Detalles de la lista (2026-08-25):**
- La cabecera dice **"Cantidad segun tu plan"**: las cantidades no las inventa nadie, son la suma de lo que piden los platos programados de esa semana, y decirlo evita que parezcan arbitrarias.
- Cada producto muestra **para qué plato es** ("para Ají de gallina +3"), con un modal si son varios. Sale de `platos[]`, que `consolidarPlan()` acumula junto a las cantidades: es la pregunta que uno se hace en el mercado (*"¿y esto para qué era?"*) y la respuesta ya estaba en los datos, sin pedir nada más.
- **Acordeon por categoria.** Con 35 productos una lista plana obliga a un scroll larguisimo en el telefono. La cabecera de cada pasillo dice cuantos llevas marcados de ese pasillo.
  - ⚠️ El estado de abierto/cerrado vive en `ABIERTAS` (un `Set`), **no en el DOM**: la lista se repinta entera al marcar, y sin eso el acordeón se cerraría en cada clic. Por lo mismo, el contador del pasillo se actualiza **a mano** al marcar, en vez de repintar.
- ** esta separada de la descarga** para poder comprobar que el documento se genera sin depender de que el navegador permita bajarlo (que es justo lo que una prueba automatica NO puede medir: en headless ni siquiera una descarga trivial de control llega a disco). Verificado: 2 paginas, 349 KB, cabecera PDF valida.
- Tras generar, se ofrece ademas un **enlace visible al PDF**:  dispara una descarga que algunos navegadores (sobre todo en movil) no muestran de forma evidente o bloquean por venir de codigo asincrono.

### Todo plato generado se guarda en la biblioteca (2026-08-25)
`crearPlato()` nace con **`guardado = 1`** tambien para las casillas del calendario. Antes nacia suelto y `limpiarPlatoHuerfano()` lo borraba al sacarlo del plan: un plato bueno se perdia salvo que el usuario se acordara de pulsar la estrella.

**Los que ya existian se migraron** (`config.platos_a_biblioteca`): 51 platos del calendario de produccion tenian `guardado = 0` y no aparecian en "Mis platos" — completarles la receta actualizaba la fila, pero esa fila nunca se listaba. La migracion sube **solo los que estan en un plan**: uno con `guardado = 0` que ya no esta en ningun calendario es basura que `limpiarPlatoHuerfano` no alcanzo a borrar, y revivirlo seria peor que dejarlo.

**Y `POST /api/plan/detallar` los deja en la biblioteca** al completarles la receta, dentro de la misma transacción que escribe los pasos: es donde el usuario espera encontrarlos después de habérsela pedido a la IA.

⚠️ **Y por eso `platos_max` dejo de contarlos.** `guardadosDe()` cuenta solo `origen = 'manual'`. Si contara los generados, un usuario Free (5) se quedaria sin poder crear nada tras generar dos dias, y el tope dejaria de medir lo que pretende medir. Lo que produce la IA ya esta limitado por `generaciones_max`.

### "Mis Recetas": filtros y paginacion (2026-08-25)
La biblioteca paso de una decena de platos a **68 en produccion** (todo lo generado se guarda desde
el 2026-08-25), y una lista plana de 68 tarjetas con un solo buscador dejo de servir.

- **Filtros**: momento, **origen** (los tuyos / los de la IA), **uso** (ya programados / nunca
  usados) y **dificultad**, mas el **orden** (recientes, antiguos, A-Z, los mas rapidos de hacer).
- 🔴 **Los resuelve el SERVIDOR, no el cliente.** Con paginacion el cliente solo tiene la pagina
  que esta mirando: filtrar ahi diria *"2 resultados"* cuando hay 20. Por eso el GET acepta
  `q`, `momento`, `origen`, `uso`, `dificultad` y `orden`.
- **`origen=ia` es `origen <> 'manual'`**, no `= 'ia'`: si no, se quedarian fuera los
  `'propuesto'` (los que el usuario nombro y la IA desarrollo), que para quien mira su
  biblioteca tampoco son "suyos".
- **La paginacion es OPCIONAL**: sin `por_pagina` se devuelve todo. El selector de platos del
  calendario (`plan.html`) llama a `/api/platos` **sin parametros** y los necesita todos para
  filtrarlos por momento; un tamano de pagina por defecto le esconderia media biblioteca sin que
  nadie lo note. ⚠️ Y ojo con el clamp: `Math.max(1, ... || 0)` convierte el "sin paginar" en
  **paginas de un plato** — ya paso; el 0 se decide **antes** de topar.
- 🔴 **Todos los ORDER BY desempatan por `p.id`.** `creado_en` es `datetime('now')`, con
  precision de **segundos**, y generar una semana crea 21 platos en el mismo segundo: sin
  desempate, SQLite puede devolver esas filas en distinto orden entre dos consultas y con
  `LIMIT/OFFSET` la pagina 2 repetiria un plato de la 1 y se saltaria otro. Lo cubre un aserto
  ("ningun plato se repite entre las dos paginas").
- **`resumen` cuenta la biblioteca ENTERA** (no la pagina ni el filtro): es lo que deja poner
  *"Míos (5)"* / *"De la IA (15)"* en las propias opciones, para saber que hay detras de cada
  filtro sin probarlos uno por uno.
- **"Sin platos" y "sin resultados" NO son lo mismo**: al segundo se le ofrece *quitar los
  filtros*, no crear un plato que quiza ya tiene.
- **Las etiquetas de los filtros son cortas a proposito** ("🍽️ Momento", "✍️ Míos"): en el
  telefono caben dos por fila y *"Todos los momentos"* se cortaba a la mitad. La opcion sin
  filtro lleva el **nombre del filtro**, que es lo que dice de que va cada uno.

### Las instrucciones del plan van ARRIBA y en amarillo (2026-08-25)
Los tres pasos (elige la semana / genera / ve o cambia cada plato) salieron de la tarjeta del
selector —donde competian con siete botones— a **su propia tarjeta `.instrucciones`, antes del
selector de fechas**, con el titulo **"📋 Instrucciones"** y el amarillo del resto de avisos.
Un aserto comprueba que van **antes** del selector, no solo que existen.

### Que significa cada nutriente (2026-08-25)
Cada fila del aporte nutricional es un **boton** que abre un modal con: el numero y su %VD, la
lectura de ese %, que es el nutriente en comida real, que pasa si hay de mas o de menos, **a quien
de la familia le importa (por su nombre)** y de donde sale el numero.
- 🔴 **No lo escribe la IA.** El texto es el mismo para todos los platos: pedirlo seria pagar una
  y otra vez por lo mismo y arriesgar que salga distinto en cada plato. Lo unico que cambia por
  hogar son las condiciones medicas, y esas ya las tenemos (`/api/hogar`, pedido en segundo
  plano; si falla, la explicacion sale igual pero sin la parte de la familia).
- **`masEsMejor` distingue los dos sentidos**: un 39% de sodio es una advertencia y un 50% de
  proteina es una buena noticia. Sin esa marca, la misma barra se leeria igual en los dos casos.
- El corte es la **regla del 5 y el 20** de las tablas nutricionales: <5% aporte bajo, 5-19
  moderado, >=20 alto.
- Las condiciones se emparejan **sin tildes y por substring** contra el texto libre que escribio
  el usuario (`hipertension`, `presion alta`…): la lista de condiciones **no es cerrada**.
- **La etiqueta entera es el area de toque** (32px de alto), no solo la insignia: en el telefono
  un icono de 14px no se acierta.
- **La marca es una insignia redonda NARANJA con una `i`**, no el caracter `ⓘ`: en gris y a 12px
  no se distinguia de la letra de al lado y nadie adivinaba que era pulsable. El naranja de la
  marca no aparece en ninguna otra parte de esa tabla.
- **La unidad vive en la columna del VALOR** ("60 g"), no pegada al nombre ("Carbohidratos (g)"):
  con el nombre largo, la insignia se caia sola a una segunda linea y descuadraba la fila.
- ⚠️ `.nutri-recos b` era `display: block` y partia en dos el nombre del integrante dentro de
  cada `<li>` ("Rosa" / ": es EL numero…"). Va acotado al hijo directo: `.nutri-recos > b`.

### "Mis compras": todo desmarcado y subtotal por pasillo (2026-08-25)
- 🔴 **TODO arranca DESMARCADO.** Esta lista se marca **en el supermercado**, producto por
  producto, conforme cae al carro: la marca significa *"ya lo tengo aqui"*. Darla por hecha
  obliga a **desmarcar** lo que no encontraste, que es justo lo que uno olvida hacer — y un
  producto marcado por inercia entra a la despensa sin haberse comprado. (El checklist de
  *Registrar compra* de la despensa es otra cosa y ahi **si** arrancan marcados: alli se declara
  lo que ya trajiste.) El producto que agregas **a mano** si nace marcado: lo agregas porque
  acabas de echarlo al carro.
- **Cada pasillo dice cuantos llevas y CUANTO llevas gastado** en el. Es en lo que uno piensa
  mientras compra (*"las carnes ya me llevaron 80 soles"*) y el total de arriba solo no lo dice.
  El subtotal cuenta **solo lo marcado**: desmarcar lo devuelve a cero aunque el precio siga
  escrito.
- ⚠️ La cuenta y el subtotal se actualizan **a mano** (`refrescarPasillo`), no repintando: un
  repintado cerraria el acordeon y perderia el sitio donde iba el usuario. El **precio** tambien
  los mueve, no solo el check.
- **En el PDF cada pasillo lleva su subtotal**: calculado si ya anotaste precios, y en blanco
  (`S/ ______`) si no, para sumarlo a mano en el mercado.
- **La lista se arma de nuevo CADA VEZ que entras**, con los platos programados de esa semana
  (tambien al volver a la pestana desde el historial). Y se dice en pantalla, porque es **lo
  contrario de la despensa**: la despensa es una sola y se arrastra; esta lista no se arrastra ni
  se guarda a medias, asi que un cambio en el plan se refleja solo.
- Lo cubre **`npm run smoke:compras`** (gratis), que crea su propio usuario, hogar, platos y
  semana fija: no hereda estado ni depende de la fecha en que se corra.

### Presupuesto POR PRODUCTO en "Mis compras" (2026-08-26)
Columna opcional: un interruptor la enciende y cada producto gana un campo para anotar cuanto
pensabas gastar en el. El total va **pegado al de lo gastado** y la diferencia compara los dos.

- **Es opcional a proposito.** Quien solo quiere marcar lo que compra no tiene por que ver un
  campo mas en cada una de las 35 filas. Con el interruptor apagado el campo **no se pinta**
  (no es que se pinte escondido): encenderlo repinta la lista de todas formas.
- **La preferencia vive en `localStorage`, los importes en la BD** (`compra_items.presupuesto`).
  Querer la columna es una decision de pantalla, como el acordeon; lo presupuestado es un dato.
- 🔴 **El total presupuestado suma TODOS los productos, no solo los comprados.** Lo que se compara
  es *"lo que pensaba gastar"* contra *"lo que gaste"*, y descontar del plan lo que al final no
  compraste haria que la comparacion **cuadrase siempre**. Lo fija un aserto.
- **Convive con `compras.presupuesto`** (el de la semana entera), que no se toca: son dos formas
  de presupuestar y el usuario puede usar una, la otra o las dos. Para no tener dos "diferencias"
  a la vez, la barra **compara contra la columna si la estas usando** y contra el presupuesto
  semanal si no — y la etiqueta lo dice (*"Presupuestado − gastado"*).
- Cada pasillo muestra los dos numeros (*"S/ 48.50 de S/ 60.00"*), y el PDF imprime lo
  presupuestado de cada producto y su total, para comparar sobre el papel en el mercado.
- ⚠️ **En movil la columna se lleva su propio renglon** (`"presu presu presu"`): a 282px, cuatro
  cosas en una linea dejan cada una en ~65px. Y **las columnas hay que repetirlas** dentro del
  `@media`: la regla de escritorio define cinco, y cambiando solo las areas quedan cinco columnas
  para tres areas — medido, la cantidad se quedaba en 20px y la cruz en 120.

### Analisis de consumo (`nutricion.routes.js` + `analisis.html`) — 2026-08-25
Mira hacia **ATRAS**: que se comio en un rango de fechas y que le dice eso a esta familia (o a
**un integrante**), con la lista de alimentos, los nutrientes y sugerencias.

- **Se monta en `/api/nutricion`, NO en `/api/analisis`**: ese ya es el **escaner de productos**,
  que es otra cosa. En el menu conviven "🔍 Analizar producto" (un producto suelto) y
  "📊 Análisis" (lo que se comio en un periodo).
- 🔴 **Reparto del trabajo: los NUMEROS los suma el backend, la LECTURA la hace la IA.** Los
  totales salen de `platos.info`, que ya esta en la BD. Pedirselos a la IA seria pagar por
  aritmetica y arriesgar cifras que no cuadran con las que el usuario ve en pantalla.
- **El resumen (`GET /resumen`) no usa IA ni cupo**: se puede abrir las veces que haga falta.
  Solo el informe (`POST /informe`) cuesta **una generacion** (`tipo='analisis'`), cobrada
  contra la **semana actual** porque un analisis puede cruzar varias semanas.
- 🔴 **El promedio es POR PERSONA Y DIA, no de la familia.** `platos.info` es el aporte de **una
  porcion**, asi que sumar los platos de un dia da lo que comio **una persona**. Por eso la clave
  se llama `por_persona_dia`, la pantalla lo dice y el prompt lo repite: leerlo como el total de
  la familia hace concluir que comen la cuarta parte de lo que comen.
- 🔴 **El promedio se divide entre los DIAS CON COMIDAS, no entre los dias del rango.** En 30 dias
  con una sola semana planificada, dividir entre 30 diria que la familia come 400 kcal al dia.
  Aun asi se muestran las dos cifras (`comidas.total` de `comidas.posibles`), porque un dia con
  solo el desayuno tambien tira el promedio hacia abajo.
- 🔴 **"Cero" y "no lo sabemos" NO son lo mismo.** Un plato sin `info` no suma 0: no se cuenta.
  Y un nutriente que **ningun** plato reporta llega a la pantalla como **"🤷 Sin datos"**: el
  backend le **borra el estado** aunque la IA lo haya marcado. Medido con platos en formato viejo:
  devolvia `fibra: bajo` con el comentario *"no tenemos registro de fibra"* — el texto decia la
  verdad y la etiqueta de al lado decia otra cosa.
- **Las calorias y los 7 nutrientes se cuentan por separado** (`con_calorias` / `con_analisis`):
  un plato anterior al aporte detallado tiene calorias pero no nutrientes, y descartarlo entero
  perderia tambien sus calorias.
- **La lista de alimentos es `consolidarPlan()`**, la misma de la lista de compras (por eso se
  exporta desde `plan.routes.js`). Dos listas distintas del mismo periodo acabarian dando
  cantidades distintas del mismo arroz.
- **Por integrante cambia la LENTE, no la comida**: la familia come los mismos platos; lo que
  cambia es si le convienen a esa persona por su edad y sus condiciones. Se le dice explicitamente
  a la IA para que no se invente un consumo individual que no tenemos.
- **`REFERENCIA_DIARIA`** (adulto: 2000 kcal, 275 g de carbohidratos, 50 g de proteina…) vive en
  el backend. **Sodio y sal siguen a la OMS** (2 g y 5 g), mas exigente que la etiqueta habitual
  de 2300 mg y lo que importa en un pais con mucha hipertension.
- **El prompt NO hereda `REGLAS_PLANIFICADOR`**: es el unico flujo que no propone platos, y esas
  reglas hablan de proponer y de la despensa — heredarlas empujaba a "arreglar" el pasado con un
  menu nuevo.
- Lo cubre **`npm run smoke:analisis`** (gratis): fija la aritmetica (sumas, promedio entre dias
  con comidas, %VD) con platos sembrados, que es justo lo que se rompe en silencio.

### Vaciar la semana (2026-08-25)
Boton **"🧹 Vaciar la semana"** en el plan + `DELETE /api/plan/semana/:semana`.
- Es **una ruta y una transaccion**, no 21 DELETE de casilla: borrar de a una deja la semana a
  medias si se corta la conexion.
- Hace lo mismo que vaciar una casilla pero para todas: **devuelve a la despensa** lo que se le
  descontó a las cocinadas y limpia los platos huerfanos. Los huerfanos se limpian **despues** de
  borrarlas todas (un mismo plato puede estar en dos casillas, y comprobarlo casilla por casilla
  lo daria por "aun en uso").
- **Las RECETAS no se pierden** y el modal lo dice: desde el 2026-08-25 todo plato generado nace
  guardado, y `limpiarPlatoHuerfano` respeta `guardado=1`. Sin ese aviso, "vaciar la semana"
  suena a que tambien se borra lo que costo una generacion.
- El boton **solo aparece si hay algo que vaciar** (mismo criterio que la lista de compras), y
  vaciar una semana ya vacia responde **404** en vez de callar.

### Las PETICIONES de la familia (`hogar.notas`) son obligatorias (2026-08-25)
Reportado por un usuario: pidio en las notas que *"todos los almuerzos incluyan una ensalada y una
bebida saludable"* y la IA lo cumplia **solo a ratos**.

**La causa no era que no llegaran**: `contexto.js` ya las mandaba. Era que llegaban como
*"NOTAS DE LA FAMILIA"* al final del bloque, **sin ninguna regla que dijera que hay que
cumplirlas**, compitiendo con la despensa y el presupuesto. Un dato de fondo, no una instruccion.

- Ahora el contexto las llama **"PETICIONES DE LA FAMILIA (obligatorias…)"** y el prompt tiene su
  **regla 9**: cumplelas en TODOS los platos a los que apliquen; si piden un acompañamiento o una
  bebida va **dentro** del plato (nombre + ingredientes + pasos); si piden algo del conjunto del
  dia, mirar las otras casillas; **la unica excepcion es una alergia o una condicion medica**.
- **La regla 5 usa la CIUDAD de verdad**: platos tipicos de esa ciudad, con su nombre local y con
  lo que hay en su mercado. El campo ya existia en el hogar y en el contexto, pero la regla lo
  mencionaba de pasada.
- ✅ **Verificado con IA real** (Gemini, hogar de prueba con esas mismas notas y ciudad Cusco):
  el almuerzo salio *"Ají de Papa con Huevo Duro, Arroz y **Ensalada Fresca con Refresco de
  Maracuyá**"* y la cena de 300 kcal frente a un almuerzo de 650 — cumpliendo tambien la segunda
  peticion ("si el almuerzo fue alto en calorias, la cena minima"). Platos de sierra: papa huayro,
  huacatay, pan andino.

### "Mis platos" pasa a llamarse "Mis Recetas" (2026-08-25)
Solo cambia el **texto visible**. Los identificadores no se tocan: la pagina sigue siendo
`platos.html`, la ruta `/api/platos` y la tabla `platos`. Renombrar rutas y tablas por un cambio
de rotulo es cambiar el motor por pintar la puerta.
- El boton del detalle del plato decia **"☆ Guardar en mi biblioteca"** sin decir que era esa
  biblioteca ni para que servia, y desde que todo plato generado nace guardado aparecia casi
  siempre ya activado: se leia como un adorno. Ahora dice **"★ Está en Mis Recetas"** /
  **"☆ Guardar en Mis Recetas"**, con un `title` que explica que guardarlo permite reutilizarlo
  **sin gastar otra generacion**, y el aviso al pulsarlo dice la consecuencia.

### Una sola cabecera para todas las secciones (2026-08-25)
Cada pagina abria distinto: unas con una tarjeta verde, otras con el titulo suelto, otras con el
formulario a pelo. **Ahora las diez abren con `.hero-seccion`**: el mismo degradado de marca del
saludo de inicio, el icono en su pastilla, el titulo y una linea que dice para que sirve esa
seccion.
- **Los colores son los MISMOS del dashboard** (`.tono-*`), y no es decoracion: el color agrupa
  por tema (Recetas naranja, Hogar morado, IA azul) **en las dos pantallas**. Si cada pagina
  eligiera el suyo, el color dejaria de significar algo.
- **`tarjetaDato()` vive en `api.js`** y la usan inicio, Mis Recetas y Mi hogar. Antes `inicio`
  tenia su propia `tarjeta()`: dos copias del mismo componente acaban divergiendo y el mismo
  dato sale naranja en un sitio y verde en otro.
- En **Mis Recetas** las cuatro tarjetas ademas **filtran** (tuyas / de la IA / sin usar): son los
  cortes que uno quiere hacer sobre un recetario grande, y tenerlos como numero y como filtro en
  el mismo sitio ahorra bajar hasta los selectores.
- En **Mi hogar** resumen lo que la IA mira: integrantes, condiciones, **alergias en rojo** (es la
  unica restriccion absoluta: verlas en 0 cuando la familia si tiene alguna es la forma mas rapida
  de notar que falta registrarla) y de donde es su cocina.
- **La tarjeta de plan** (Mi suscripcion) dejo de ser un parrafo con `<br>`: en el telefono se
  leia como una frase corrida (*"Analisis ilimitados productos guardados ilimitados…"*). Cada
  prestacion es una linea con ✓, y lo que el plan **no** trae va tachado y en gris para que no se
  lea como una ventaja mas.
  - ⚠️ La concordancia de `limite()` miraba la **ultima letra de la frase**, asi que "recetas
    guardadas" daba *"ilimitados"*. Ahora mira el **sustantivo** (la primera palabra).

### El formulario de la compra en movil (2026-08-25)
Reportado: *"el formulario de compras semanales se distorsiona en movil"*. Medido en Chrome real
a 390px, eran tres cosas a la vez:
1. **"Presupuesto semanal (S/)" se partia en dos lineas** y empujaba su input mas abajo que el de
   al lado: la fila se veia torcida. Las etiquetas pasan a caber en una linea ("Comprado el",
   "Presupuesto (S/)") y la rejilla alinea por **abajo** (`align-items: end`), que aguanta el
   descuadre aunque una etiqueta vuelva a partirse.
2. **Un input de fecha y uno numerico no miden lo mismo** por su cuenta (47 vs 45 px). Dos campos
   pegados con 2 px de diferencia se leen como una fila mal hecha: se les fija la altura, y en las
   **dos** pantallas (en escritorio van los cuatro en una fila y tambien se notaba).
3. **Los cuatro botones se repartian 2 + 1 + 1** con anchos distintos segun lo que midiera cada
   texto. En movil van en dos columnas iguales, y "producto" se esconde (`.solo-pc`) para que
   "+ Agregar" no se parta en dos lineas y estire su fila.

La regla es **compartida** (`.campos-compra, .campos-analisis, .campos-periodo`): las tres
pantallas con una fila de campos tenian el mismo problema, y en tres reglas separadas la proxima
se arreglaria solo en dos. Un numero **impar** de campos deja el ultimo a lo ancho en vez de a
media pantalla con un hueco al lado.

⚠️ **`npm run movil` ahora lo comprueba solo** ("filas de campos: cuadradas"): mira que los
campos de una misma fila acaben a la misma altura **y** midan lo mismo.
- **Las filas se agrupan por SOLAPE vertical**, no por su coordenada de arriba. Los dos descuadres
  que se quieren cazar mueven justamente esa coordenada, asi que agrupando por ella los dos campos
  caian en "filas" distintas de una sola celda — que la comprobacion se salta. **La primera version
  no detectaba nada** y parecia funcionar.
- Se verifico rompiendo un campo **en caliente** (24 px mas alto, y la etiqueta partida en dos):
  la comprobacion los caza los dos. Una comprobacion que no puede fallar no comprueba nada.

### La LISTA de productos en movil (2026-08-25)
Reportado dos veces como *"se distorsiona"*. La fila de cada producto se veia **deshecha**: el
nombre partido letra a letra en vertical (*"A…" / "v…"*), el *"para que plato es"* en una columna
de palabras sueltas y la cruz de quitar estirada a lo ancho de media pantalla.

🔴 **La causa: con `grid-template-areas`, una columna `auto` la dimensiona el elemento MAS ANCHO
de toda la columna, no el de la fila que estas mirando.** El layout era
`"check quitar" / "cant precio"` con `1fr auto`: la columna derecha la mandaba el **bloque del
precio** (ancho), que se quedaba con 172 de los 282 px, y al nombre le tocaban 79.

Ahora el producto ocupa **la primera linea entera** y debajo van cantidad, precio y quitar:
`"check check check" / "cant precio quitar"`, con la cantidad algo mas ancha que el precio
("17 cucharadas" es mas largo que "S/ 0.00"). El nombre y el *"para que es"* comparten linea y el
segundo baja al siguiente renglon si no cabe, en vez de estrujarse el uno al otro.

⚠️ **`npm run movil` no lo veia, y por eso paso dos veces.** Dos arreglos en el revisor:
- **Ahora ABRE los acordeones antes de medir.** Lo que esta dentro de uno cerrado no tiene tamaño:
  la revision pasaba por encima de la lista entera y daba "todo correcto" con las filas rotas.
- **Comprueba el "texto aplastado"**: una caja de menos de 70px cuyo contenido necesita mas del
  doble de ancho. Es el sintoma exacto de una columna de grid que se quedo sin sitio, y no lo
  pillaba ninguna otra comprobacion (no hay desborde de pagina ni texto pequeño).
  Verificado volviendo al layout roto: **25 avisos**; con el bueno, ninguno.
- De paso, **el area de toque de una casilla es su `<label>`**, no el cuadradito de 22px: el aviso
  saltaba en tres pantallas sin nada que arreglar, y a los avisos que siempre estan ahi se les
  deja de hacer caso.

### Fase 6 — admin
Backend listo (catálogo de ingredientes + costo sumando `analisis` UNION `generaciones`). Falta pulir la UI: mostrar el desglose de generaciones por tipo (menu/dia/plato/detalle/verificar) y el aviso de crédito.

## Deuda y avisos

- **🔥 Crédito Gemini compartido — AHORA EN PRODUCCIÓN.** La `GEMINI_API_KEY` es **la misma de MedicaIA y NutriIA** (verificado: bytes idénticos), y producción corre con **prioridad Gemini**. Si NutriChefIA se come el crédito, **tumba también a las otras dos apps** — y al revés. Ya no es un "considerarlo antes de producción": es una dependencia viva entre tres apps públicas. Sacar una key propia. El panel admin (`/api/admin/resumen`) avisa al 20% de crédito.
- **🎨 Rebranding: ✅ HECHO. Mascota flotante propia ✅ (2026-07-16). Falta solo el chef del semáforo.**
  - **La paleta sale MUESTREADA del logo**, no elegida a ojo: verde **`#124819`** ("Nutri" y el eslogan), naranja **`#ea6b02`** ("Chef"), verde **`#538e18`** ("IA"). Están en las variables al inicio de `style.css` + los `rgba()` del fondo del login (`.auth-wrap`, donde no se puede usar `var()`). Si retocas el logo, **vuelve a muestrearlo**; los `~#1e6b2f / ~#f07d1a / ~#7ab829` que figuraban aquí antes eran aproximaciones a ojo que no existían en el logotipo.
  - `theme-color` (8 páginas) y `manifest.webmanifest` → `#124819`. `logo.png`, `favicon.png`, `icon-192/512.png` ya son los de NutriChefIA.
  - Ojo: el **semáforo del escáner** (`sem-*`, verde/ámbar/rojo) tiene su propia paleta semántica y **no se toca** al repaletear.
  - ✅ **Mascota flotante propia (2026-07-16).** Un chef distinto **a la derecha de cada pantalla** vía la clase `.mascota` (fija abajo-derecha, `pointer-events:none`, z-index por debajo de los modales): `mascota-home.png` (saluda) en el escáner/home, `mascota-plan.png` (bolsa) en el plan, `mascota-despensa.png` (checklist) en la despensa, `mascota-platos.png` (olla) en Mis platos. Los **originales de marca** están en `archivos/` (`mascota.png` + `mascota1/2/3.png`) y **sí se versionan**.
    - **El arte venía RGB sin canal alfa (fondo blanco sólido).** Como el chef lleva **gorro y casaca blancos**, un "quitar el blanco" global lo agujereaba. Se recortó con **flood-fill del blanco DESDE LOS BORDES** (solo el fondo conectado al borde se vuelve transparente; el gorro y la casaca, rodeados por el cuerpo, se conservan). El script está en el scratchpad de esa sesión — no en el repo; si necesitas re-recortar arte nuevo, es un decodificador PNG en Node puro (`zlib`) con flood-fill + feather del halo. No había ImageMagick/PIL/sharp en la máquina.
  - **El favicon va con fondo TRANSPARENTE** (2026-08-25). Traia un cuadrado blanco opaco que
    se veia como un recuadro en las pestañas oscuras. Se recorta con
    `node scripts/recortar-fondo.js entrada.png salida.png`, que hace **inundacion del blanco
    DESDE LOS BORDES**: un "quitar todo lo blanco" agujerearia el gorro y la casaca del chef, que
    tambien son blancos. El script vive ya **en el repo** (antes era codigo de un scratchpad que
    habia que reescribir cada vez) y es Node puro con `zlib`: aqui no hay ImageMagick ni sharp.
    - ⚠️ **`apple-touch-icon` NO apunta al favicon**, sino a `icon-192.png`, que sigue siendo
      solido: iOS compone los iconos transparentes **sobre negro** y el chef quedaria recortado
      dentro de un cuadrado negro. Lo mismo con el icono de las notificaciones.
    - El `?v=` del favicon subio a **3**. Los navegadores cachean el favicon con especial
      insistencia; sin cambiar la version se sigue viendo el blanco de siempre.
    - Los iconos de la PWA (`icon-192/512`) y `logo.png` **siguen con fondo blanco** a proposito:
      los primeros van enmascarados por el sistema y el logo vive sobre la barra lateral blanca.
  - ⚠️ **Falta el chef del semáforo del escáner** (3 versiones: sí / regular / no). Se retiró el de NutriIA porque `si/regular/no.png` llevaban el logo "N" en el pecho. **El sitio está reservado y estilado**: `.sem-personaje` + el campo `img` del objeto `SEM` (el banner ya lo pinta **si existe**). Con el arte listo, es rellenar, no rediseñar. Los originales de NutriIA siguen en `C:\app-nutriia\public\img\` si hicieran falta.
  - `archivos/` **SÍ se versiona** (se sacó del `.gitignore` heredado de NutriIA): ahí viven los únicos originales de marca y estaban solo en un disco.
- **✅ Contraseña del admin en producción: CAMBIADA** (verificado el 2026-07-29: `admin@nutrichefia.pe` con `admin123` devuelve **401**; el usuario confirmó que la cambió él). Era la deuda de seguridad más urgente, porque `admin123` es la del `.env.example` **que está en el repo** y de ese panel cuelgan los pagos Yape, los planes y la config de IA. Se cambia sin tocar la BD desde el panel admin → Config → "Cambiar mi contraseña" (`PUT /api/admin/password`, exige la actual) o con `node scripts/cambiar-password-admin.js "NuevaClave"`. ⚠️ **En local sigue siendo `admin123`** (es lo que siembra `npm run seed`), así que no confundas los dos entornos al probar.
- **🧾 El titular de Yape es un placeholder** ("NutriChefIA Peru"). El número sí es real (976901977). Vive en la tabla `config`, no en el `.env`: se cambia desde el panel admin. Con un titular falso nadie puede pagar.
- **`platos.region`** se llena al generar pero no se usa en ninguna consulta todavía.
- **Despliegue: ✅ EN PRODUCCIÓN** desde 2026-07-16 → **https://nutrichefia.solucionesctec.com** (PM2 `nutrichefia`, puerto 4005, SSL con renovación automática). Repo: `github.com/abantostechnology2030/nutrichef`. Redeploy y trampas del día del despliegue en `DEPLOY.md`.
- **Cobertura de pruebas:** los smoke tests **no** tocan el escáner con imagen, el pago Yape ni el panel admin. Tampoco hay prueba del **fallback entre proveedores** — y ahí ya se escondió un bug meses (ver el aviso de Gemini vs Claude arriba).
