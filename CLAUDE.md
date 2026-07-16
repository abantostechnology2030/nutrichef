# CLAUDE.md

Guía para trabajar en **NutriChefIA**. Lee esto antes de tocar el código.

## Qué es

App web que **planifica las comidas de una familia** (desayuno / almuerzo / cena, de lunes a domingo) con IA, para el mercado peruano. El usuario configura su **hogar** (integrantes, condiciones médicas, alergias, dieta, región), registra su **compra semanal** en la despensa, y la IA **propone los platos** usando los ingredientes con los que ya cuenta, adaptando recetas de su región al número de comensales y a sus restricciones de salud. Incluye además un **escáner de productos** (foto o nombre → semáforo verde/ámbar/rojo). Modelo **freemium** con pagos manuales por **Yape** aprobados por un admin.

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
npm run smoke:platos # smoke test de la biblioteca + tope del plan (gratis, ~5s)
npm run smoke:plan   # smoke test del calendario + generacion IA REAL (~$0.01, ~40s)
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

## Estado — EN CONSTRUCCIÓN

Solo local (`http://localhost:3002`). Admin por defecto: `admin@nutrichefia.pe` / `admin123`.

| Fase | Qué | Estado |
|---|---|---|
| 1 | Base: esquema limpio, auth, freemium, Yape, admin, escáner | ✅ **hecha** |
| 2 | Hogar + Despensa (config previa, sin IA) | ✅ **hecha** |
| 3 | Generador IA **por día** + calendario 7×3 + regenerar día/plato | ✅ **hecha** |
| 4 | Detalle del plato (pasos) + platos manuales/biblioteca + **verificar platos propuestos** | ✅ **hecha** |
| 5 | Lista de faltantes + PDF | ⬜ pendiente |
| 6 | Admin: catálogo de ingredientes + medidor con generaciones | 🟡 backend listo, falta pulir UI |

**Funciona hoy, de punta a punta:** registro/login → configurar hogar → registrar la
compra → **generar el calendario día por día con IA** → navegar semanas, cambiar un plato,
marcar cocinado, copiar una semana, ver el detalle de cada plato → **curar su biblioteca en
"Mis platos"** (crear/editar/borrar recetas propias). Más el escáner de productos, el
paywall Yape y el panel admin.

> ⚠️ El modal de detalle del plato avisa que los pasos de preparación aún no existen
> (`platos.pasos` sigue en NULL para los platos que genera la IA): es lo que falta de la
> fase 4, junto con verificar platos propuestos.

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
    despensa.routes.js   # inventario + /compra (bulk semanal) + /compras (historial)
    plan.routes.js       # calendario 7x3 + /generar (POR DIA) + /detallar + /copiar (registra generaciones)
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
  despensa.html          # inventario + registrar compra semanal
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
- **hogar** (1 por usuario, UNIQUE): `region` (costa|sierra|selva), `ciudad`, `dieta`, `presupuesto`, `comensales`, **`configurado`** = gate del onboarding (sin hogar la IA no puede proponer nada).
- **integrantes**: `condiciones` (JSON) y **`alergias`** (JSON) → las alergias son **exclusión dura** en el prompt, no una preferencia.
- **ingredientes_catalogo** (admin): base para abastecer la despensa. Categorías de cocina real (abarrote/verdura/fruta/carne/pescado/lacteo/huevo/legumbre/condimento/bebida/otro). Sembrado con ~51 ingredientes peruanos.
- **despensa**: **inventario simple** — `nivel` (`poco|normal|bastante`), sin descuento automático al cocinar. UNIQUE por usuario + nombre normalizado. Decisión deliberada: descontar gramos exigía conversión de unidades y mermas, y la IA razona bien con disponibilidad.
- **compras**: cabecera de la compra semanal; sus ítems entran a `despensa`.
- **platos**: `ingredientes` (JSON `[{nombre,cantidad,unidad}]`), `faltantes` (JSON: lo que no estaba en la despensa al generar), **`pasos`** (JSON | **NULL hasta que se pidan** — hoy siempre NULL, los llena la fase 4), `info` (JSON | idem), `nota` (adaptación por condición médica), `momento`, `porciones`, `tiempo_min`, `dificultad`, `origen` (`ia`|`propuesto`|`manual`), **`guardado`**.
  > **`guardado` separa la biblioteca del plan**, y no es cosmético: llenar una semana crea **21 platos** y el plan Free permite **5**. Si `platos_max` contara todos, planificar sería imposible. El tope aplica a lo que el usuario decide **curar** (`guardado=1`), no a lo que la IA produce para el calendario.
- **plan_comidas**: calendario. `semana` = fecha del **lunes**; `dia` 0..6 (0=Dom); `momento`; **UNIQUE(usuario, semana, dia, momento)** = una casilla, un plato. **`cobertura`** (JSON de la verificación contra la despensa) vive aquí y **no** en `platos`: el plato es estable, lo que cambia es la despensa (mismo plato puede "alcanzar" esta semana y "faltar" la otra).
- **generaciones**: log de llamadas IA del planificador (`tipo`: menu|dia|plato|detalle|verificar). Cumple **dos** funciones: el gate `generaciones_max` por semana **y** el costo real en el admin.
- **pagos**: `numero_operacion` UNIQUE, `comprobante_path`, `estado` `pendiente|aprobado|rechazado`.
- **config**: clave/valor (`yape_numero`, `yape_titular`, `yape_qr_path`, `ai_modo`, `ai_prioridad`, `credito_gemini`, `credito_claude`).

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
- **Inventario simple**: `nivel` (`poco|normal|bastante`), sin descuento al cocinar (ver decisión arriba).
- **Nunca duplica**: hay un UNIQUE sobre `(usuario_id, LOWER(TRIM(nombre)))`. `guardarIngrediente()` resuelve el upsert **a mano** (busca y luego UPDATE/INSERT) porque el índice es sobre una **expresión**.
- **Categoría automática**: si el ingrediente está en `ingredientes_catalogo`, hereda su categoría; si no, cae a `otro`. El usuario no tiene que clasificar nada.
- **`POST /compra`** registra la compra semanal completa **en una transacción**: una compra a medias dejaría a la IA proponiendo platos con ingredientes que el usuario no llegó a registrar.
- **`compras.total_items`** guarda cuántos ingredientes traía la compra **al registrarla**. Los ítems viven en `despensa`, que es mutable: contar por `compra_id` daría un historial que se reescribe solo ("compré 6" pasaría a decir 5 al borrar uno). El conteo por `compra_id` sigue exponiéndose, pero como **`vigentes`**, que significa otra cosa.

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
- **`POST /api/plan/detallar`** (`tipo='detalle'`) es **solo backfill**: completa la `info`
  y/o los `pasos` de los platos que nacieron sin ellos (la nutrición se sumó primero y la
  receta después, así que hay platos con una y sin la otra). Los platos nuevos ya nacen con
  las dos y **no pasan por aquí**. Es **batch** (los pendientes de la semana = 1 llamada) y,
  si no falta ninguno, **responde sin llamar a la IA ni consumir cupo**: no se cobra por no
  hacer nada. Una vez calculados, `info` y `pasos` son cache permanente (el plato no cambia).
  - Cada plato le dice a la IA en **`necesita`** qué le falta (`info`, `pasos` o ambos), y la
    ruta **solo escribe lo que faltaba**: pedir o pisar lo que el plato ya tenía sería pagar
    dos veces y arriesgar que se lo reescriba distinto.
  - Medido: 21 platos a los que les faltaba la receta = **1 llamada, 3.492/3.450 tokens, $0.0097**.
- La UI usa las clases `sem-*-bn` del **escáner**: es el mismo lenguaje visual verde/ámbar/rojo.
  Ojo con el mapeo: la BD dice **`ambar`** y la clase CSS se llama **`amarillo`**.

> **`MAX_TOKENS_PLANIFICADOR = 24000`** y **1.400 por casilla** en `generarPlatos`. El techo por casilla fue subiendo con lo que trae el plato: ~350 tokens medidos con la receta base, ~550 al sumar `info`, **~900 al sumar `pasos`**. Con los 700 de antes, pedir un día se habría truncado — y un JSON cortado **no pierde un plato: pierde la llamada entera**. Subir el techo **no cuesta nada** (solo se pagan los tokens generados). Si le agregas campos al plato, **vuelve a medir**: `SELECT output_tokens FROM generaciones`.

**Costo medido (Gemini flash, `gemini-2.5-flash`):**

| Operación | Tokens (in / out) | Costo |
|---|---|---|
| **Un día (3 platos, con receta + nutrición)** | 1.823 / 1.825 | **$0.0051** |
| Una semana completa = 7 días sueltos | — | **~$0.036** |
| Un día sin receta (histórico) | 1.636 / 1.382 | $0.0039 |
| Un plato suelto | ~2.340 / ~530 | ~$0.002 |
| Backfill de 21 platos (`/detallar`) | 3.492 / 3.450 | $0.0097 |
| ~~Menú de 21 platos de un golpe~~ (histórico, ruta eliminada) | 1.568 / 11.523 | $0.029 |

**Generar día a día no salió más caro que la semana de un golpe** (~$0.028 vs $0.029 sin receta). El contexto se repite en cada llamada, pero la entrada de flash es ~8x más barata que la salida, y la salida total es la misma. La intuición de "7 llamadas cuestan 7x" es falsa aquí — **medido, no estimado**. La receta subió el día un **31%** ($0.0039 → $0.0051).

> ### 🔥 El costo real depende de `ai_modo`, y hoy NO es el de esta tabla
> La config de la BD está en **`ai_modo='ambos'` con `ai_prioridad='claude'`**: **Claude
> atiende primero** y Gemini solo entra como fallback. El **mismo día**, medido con los dos:
>
> | Proveedor | Tokens (in / out) | Un día | Una semana |
> |---|---|---|---|
> | Gemini flash | 1.823 / 1.825 | $0.0051 | ~$0.036 |
> | **Claude sonnet (gateway)** | **4.197 / 1.540** | **$0.0357** | **~$0.25** |
>
> **7x.** Y ojo con el detalle que engaña: Claude reporta **2,3x más tokens de entrada por
> el mismo prompt** (4.197 vs 1.823) — su tokenizador es menos eficiente en español. Al
> comparar mediciones, **mira siempre la columna `proveedor`**: aplicarle la tarifa de
> Gemini a una fila de Claude da un costo 7x optimista. Ya me pasó.
>
> En la práctica se ha visto **caer a Gemini solo** (`[IA] fallo claude: ...JSON`): el
> gateway devuelve JSON malformado a ratos y el fallback salva la llamada. O sea que el
> costo real oscila entre $0.036 y $0.25 por semana **según esté el gateway**. Si el
> objetivo es el costo, poner `ai_modo='gemini'` desde el admin.

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
- Las **alergias se repiten aparte** en el prompt (aunque ya vayan dentro de `integrantes`) para que la restricción dura sea imposible de pasar por alto.
- Auditoría de una generación real (hogar con diabetes + hipertensión + intolerancia a la lactosa, alergias a maní y mariscos): **0 alérgenos, 21/21 platos usando la despensa, 0 repetidos, 21/21 con nota de adaptación**, y distinguió correctamente que "mariscos" no excluye pescado (propuso trucha).

### Condiciones médicas — responsabilidad real
Las **alergias** son exclusión **absoluta** en el prompt (nunca "preferencia"). Las **condiciones** (diabetes, hipertensión…) adaptan el plato y generan advertencias. Una alergia mal manejada no es un mal consejo, es un daño: al tocar los prompts, no bajes esa restricción.

### Flujo de pago Yape + vencimiento
Usuario sube comprobante (`numero_operacion` único, un pago pendiente a la vez) → `pendiente` → admin aprueba → transacción asigna el plan, **reinicia `analisis_restantes`** y fija `plan_expira` = hoy + `dias_vigencia` (si renueva antes de vencer, extiende desde la fecha vigente). Al vencer, `usuarioPublico` **degrada a Free** en el siguiente acceso (perezoso, sin cron).

## Convenciones

- **Idioma:** todo en **español**; identificadores ASCII sin tildes.
- **Errores:** `res.status(XXX).json({ error })`. Códigos: **402** paywall, **403** upgrade, **502** fallo IA, **409** conflicto.
- **Auth:** `requiereAuth` adjunta `req.usuario` (vía `usuarioPublico`, fresco de BD). Admin: `router.use(requiereAuth, requiereAdmin)`.
- **Frontend:** helpers en `public/js/api.js` (`Sesion`, `api()`, `exigirSesion()`, `pintarSidebar()`, `confirmar()`, `CAT_INFO`/`chipCategoria()`, `MOMENTO_INFO`). Token en `localStorage` (`nutrichefia_token`/`nutrichefia_user`).
- **Nombres en la UI:** "**Mi suscripción**" = pagos (`mi-plan.html`). "**Plan de comidas**" = el calendario (`plan.html`). No llamar "plan" a los dos.
- **Fuente única de categorías:** `CATEGORIAS_ING` en `db.js` y `CAT_INFO` en `api.js` deben coincidir.

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

## POR DÓNDE SEGUIR (pausa: 2026-07-16, fases 1-4 hechas)

> **Un frente abierto:** la **fase 5** (lista de faltantes + PDF). El **rebranding ya está
> aplicado** (solo falta el arte propio de la mascota) y el **despliegue** está preparado
> pero no ejecutado — ver Deuda y `DEPLOY.md`.

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

### Fase 5 — lista de faltantes + PDF
- `platos.faltantes` **ya se llena** en cada generación (medido: ~23 faltantes distintos en una semana).
- Falta agregar: `GET /api/plan/faltantes?semana=` que una los `faltantes` de los 21 platos + los de la verificación (`plan_comidas.cobertura`), deduplicados.
- `public/js/vendor/jspdf.umd.min.js` **ya está vendorizado** (viene de NutriIA) para el PDF.

### Fase 6 — admin
Backend listo (catálogo de ingredientes + costo sumando `analisis` UNION `generaciones`). Falta pulir la UI: mostrar el desglose de generaciones por tipo (menu/dia/plato/detalle/verificar) y el aviso de crédito.

## Deuda y avisos

- **⚠️ Crédito Gemini compartido:** el `.env` se copió de NutriIA, así que la `GEMINI_API_KEY` es **la misma de MedicaIA y NutriIA** — el crédito es compartido entre **tres** apps y esta es, de lejos, la más hambrienta de tokens. Considerar una key propia antes de producción.
- **🎨 Rebranding: ✅ HECHO (2026-07-15). Falta solo la mascota propia.**
  - **La paleta sale MUESTREADA del logo**, no elegida a ojo: verde **`#124819`** ("Nutri" y el eslogan), naranja **`#ea6b02`** ("Chef"), verde **`#538e18`** ("IA"). Están en las variables al inicio de `style.css` + los `rgba()` del fondo del login (`.auth-wrap`, donde no se puede usar `var()`). Si retocas el logo, **vuelve a muestrearlo**; los `~#1e6b2f / ~#f07d1a / ~#7ab829` que figuraban aquí antes eran aproximaciones a ojo que no existían en el logotipo.
  - `theme-color` (8 páginas) y `manifest.webmanifest` → `#124819`. `logo.png`, `favicon.png`, `icon-192/512.png` ya son los de NutriChefIA.
  - Ojo: el **semáforo del escáner** (`sem-*`, verde/ámbar/rojo) tiene su propia paleta semántica y **no se toca** al repaletear.
  - ⚠️ **Falta arte propio de la mascota (el chef).** Se retiró el de NutriIA porque mostraba **otra marca al usuario**: `p1.png` (el superhéroe del escudo "N") flotaba en el escáner y `si/regular/no.png` (los 3 personajes del semáforo) llevaban el logo "N" en el pecho. También se borraron `bg-web-v8/bg-mobile-v1.png` (arte de NutriIA que anunciaba *loncheras*, ya sin uso en el CSS) y `p2/p3.png` (huérfanos). Los originales siguen en `C:\app-nutriia\public\img\` si hicieran falta.
    - **Los sitios están reservados y estilados**: `.mascota` en `style.css` + el hueco en `app.html`, y `.sem-personaje` + el campo `img` del objeto `SEM` (el banner ya lo pinta **si existe**). Con el arte listo, es rellenar, no rediseñar.
    - Hace falta el chef en **3 versiones** (sí / regular / no) para el semáforo. `archivos/favicon.png` sirve de base para la mascota flotante, pero **tiene fondo blanco sólido** (0% alfa) y el chef lleva **gorro y casaca blancos**: un "quitar el blanco" global lo agujerearía. Hay que recortarlo con relleno desde los bordes, o pedir el arte con transparencia.
  - ⚠️ **`archivos/` está en `.gitignore`** (heredado de NutriIA): los originales de marca no se versionarían. Revisar antes de crear el repo.
- **Credenciales admin** por defecto (`admin@nutrichefia.pe`/`admin123`): cambiar contraseña y datos de Yape (placeholders).
- **`platos.region`** se llena al generar pero no se usa en ninguna consulta todavía.
- **Despliegue: preparado, NO ejecutado.** Ya existen `DEPLOY.md`, `ecosystem.config.cjs` (PM2 `nutrichefia`, puerto **4005**), `nginx.nutrichef.solucionesctec.com.conf` y `.github/workflows/deploy.yml`. El DNS de **`nutrichef.solucionesctec.com` → `87.99.144.139`** ya resuelve. **Sigue faltando lo bloqueante: este proyecto no es un repo git** (el deploy clona desde GitHub). Ver `DEPLOY.md` → "Prerequisitos que faltan".
  - ⚠️ Antes de `git init`: **`archivos/` está gitignored** y ahí están los únicos originales de marca (`logotipo.png`, `favicon.png`). Decidir si se versionan o se mueven a `public/img/` con el rebranding.
- **Cobertura de pruebas:** los smoke tests no tocan el escáner con imagen, el pago Yape ni el panel admin.
