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
npm run smoke:platos # smoke test de la biblioteca + el calendario sin IA (gratis, ~15s)
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

**https://nutrichef.solucionesctec.com** desde 2026-07-16 (ver `DEPLOY.md`). Local: `http://localhost:3002`. Admin: `admin@nutrichefia.pe` / `admin123` — **cambiar la contraseña**.

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
    auth.routes.js       # /registro, /login, /yo
    analisis.routes.js   # escaner: /texto (cache-first), /imagen (2 fotos), /historial, DELETE
    hogar.routes.js      # hogar + CRUD de integrantes (condiciones y alergias)
    despensa.routes.js   # inventario (alta inmediata) + /compra (snapshot por periodo) + /compras (historial, con borrado)
    plan.routes.js       # calendario 7x3 + /generar (POR DIA) + /verificar + /detallar + /copiar + /faltantes y /necesidad
    platos.routes.js     # biblioteca: CRUD de platos manuales + guardar/quitar (tope platos_max)
    pagos.routes.js      # info del paywall (incl. yape_qr) + comprobante Yape + /historial
    soporte.routes.js    # mensajes de contacto
    admin.routes.js      # planes, pagos, usuarios, config (motor IA), QR Yape, catalogo de ingredientes
  services/
    ai.service.js        # capa de IA: backends Gemini/Claude con fallback + prompts
    contexto.js          # arma el contexto del hogar para los prompts (fuente unica)
public/
  index.html             # login / registro
  app.html               # ESCANER de productos (semaforo)
  hogar.html             # familia, condiciones medicas, alergias, region
  despensa.html          # ver la despensa (buscar) + registrar compra (agregar producto + marcar comprados)
  plan.html              # CALENDARIO 7x3 + boton "Generar dia" con IA en cada dia
  platos.html            # "Mis platos": la biblioteca (crear/editar/borrar recetas)
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

## Convenciones

- **Idioma:** todo en **español**; identificadores ASCII sin tildes.
- **Errores:** `res.status(XXX).json({ error })`. Códigos: **402** paywall, **403** upgrade, **502** fallo IA, **409** conflicto.
- **Auth:** `requiereAuth` adjunta `req.usuario` (vía `usuarioPublico`, fresco de BD). Admin: `router.use(requiereAuth, requiereAdmin)`.
- **Frontend:** helpers en `public/js/api.js` (`Sesion`, `api()`, `exigirSesion()`, `pintarSidebar()`, `confirmar()`, `CAT_INFO`/`chipCategoria()`, `MOMENTO_INFO`). Token en `localStorage` (`nutrichefia_token`/`nutrichefia_user`).
- **Nombres en la UI:** "**Mi suscripción**" = pagos (`mi-plan.html`). "**Plan de comidas**" = el calendario (`plan.html`). No llamar "plan" a los dos.
- **Fuente única de categorías:** `CATEGORIAS_ING` en `db.js` y `CAT_INFO` en `api.js` deben coincidir.
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
- **`sed` puede fallar en silencio.** Si editas con `sed`, verifica el resultado: di por hecho que un bloque se había insertado y no era así.

## POR DÓNDE SEGUIR (pausa: 2026-07-18 · fases 1-5 hechas · **EN PRODUCCIÓN**)

> **La app es pública:** https://nutrichef.solucionesctec.com. Cualquier cambio que subas a
> `main` y despliegues lo ven usuarios reales. Redeploy y trampas: `DEPLOY.md`.
>
> **Antes de tocar código, hay 3 cosas de operación pendientes** (ver Deuda): la contraseña
> del admin sigue siendo `admin123` **y está en el repo**; el titular de Yape es un
> placeholder (nadie puede pagarte); y la key de Gemini es **compartida con MedicaIA y
> NutriIA**, las tres en producción.
>
> **Lo siguiente en producto es la fase 6** (pulir la UI del admin). La fase 5 (compra por
> periodo + lista de faltantes + PDF) se cerró el 2026-07-18. Del rebranding solo falta el
> arte propio del chef del semáforo.
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
> comprobación que cierra el modelo. **Producción sigue con el ancla vieja hasta que se
> despliegue**, y al arrancar allí la migración borrará el `consume` de los platos existentes
> (ver `config.consume_escala`): los usuarios verán reaparecer "🍳 Completar platos".

> **La fase 4 se cerró el 2026-07-16.** El calendario ya tiene **las tres vías** para llenar
> una casilla: *"✨ Proponer"* (la IA elige), *"✍️ Ya sé qué cocinar"* (la familia elige y la
> IA verifica) y *"📋 Mis platos"* (de su biblioteca, sin IA). El modal del plato muestra la
> receta, el aporte nutricional, la cobertura y un botón **"☆ Guardar en mi biblioteca"**.

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
     NULL), y el botón del calendario es **"🍳 Completar platos (N)"**, que solo aparece si
     hay alguno incompleto.
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
  - ⚠️ **Falta el chef del semáforo del escáner** (3 versiones: sí / regular / no). Se retiró el de NutriIA porque `si/regular/no.png` llevaban el logo "N" en el pecho. **El sitio está reservado y estilado**: `.sem-personaje` + el campo `img` del objeto `SEM` (el banner ya lo pinta **si existe**). Con el arte listo, es rellenar, no rediseñar. Los originales de NutriIA siguen en `C:\app-nutriia\public\img\` si hicieran falta.
  - `archivos/` **SÍ se versiona** (se sacó del `.gitignore` heredado de NutriIA): ahí viven los únicos originales de marca y estaban solo en un disco.
- **🔓 Credenciales admin en PRODUCCIÓN: `admin@nutrichefia.pe` / `admin123`.** Esa contraseña es la del `.env.example` **que está en el repo**: quien lo vea, la sabe. El sitio es público y de ahí cuelgan los pagos Yape, los planes y la config de IA. **Cambiarla.** Desde 2026-07-16 **ya se puede cambiar sin tocar la BD**: panel admin → Config → "Cambiar mi contraseña" (`PUT /api/admin/password`, exige la actual), o `node scripts/cambiar-password-admin.js "NuevaClave"` (funciona en local y en el server). Sigue sin cambiarse en producción.
- **🧾 El titular de Yape es un placeholder** ("NutriChefIA Peru"). El número sí es real (976901977). Vive en la tabla `config`, no en el `.env`: se cambia desde el panel admin. Con un titular falso nadie puede pagar.
- **`platos.region`** se llena al generar pero no se usa en ninguna consulta todavía.
- **Despliegue: ✅ EN PRODUCCIÓN** desde 2026-07-16 → **https://nutrichef.solucionesctec.com** (PM2 `nutrichefia`, puerto 4005, SSL con renovación automática). Repo: `github.com/abantostechnology2030/nutrichef`. Redeploy y trampas del día del despliegue en `DEPLOY.md`.
- **Cobertura de pruebas:** los smoke tests **no** tocan el escáner con imagen, el pago Yape ni el panel admin. Tampoco hay prueba del **fallback entre proveedores** — y ahí ya se escondió un bug meses (ver el aviso de Gemini vs Claude arriba).
