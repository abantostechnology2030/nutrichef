// Capa de IA de NutriChefIA. Proveedor intercambiable en runtime (config del admin):
//   ai_modo = gemini | claude | ambos  ;  ai_prioridad = gemini | claude (si "ambos")
// Con "ambos" se usa el prioritario y, si falla tras sus reintentos, cae al otro.
//
// Diseño: cada backend solo sabe hablar su dialecto y expone UN metodo, pedir(system, partes).
// Los metodos de dominio (explicarPorTexto, etc.) se escriben UNA vez sobre esa base, en vez
// de duplicarse por proveedor.
//
// "partes" es el formato neutral del contenido del usuario:
//   [{ texto: '...' }, { imagen: { base64, mediaType } }]

const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

// ===== Prompts: ESCANER de productos =====
const SYSTEM_ANALISIS = `Actua como un nutricionista experto y divulgador. Se te dara el nombre y/o FOTOS de un ALIMENTO O PRODUCTO DE CONSUMO: puede ser **procesado** (galletas, chocolates, snacks, bebidas, cereales, embutidos, etc.) o **natural/fresco** (frutas, verduras, carnes, pescados, huevos, legumbres, lacteos, etc.). Analiza sus componentes y valor nutricional y explica TODO en lenguaje simple, apto para cualquier persona. Evita tecnicismos.

Responde UNICAMENTE con un objeto JSON limpio (sin texto antes/despues ni bloques markdown) con estas claves:
- "nombre": nombre del producto (marca/tipo). Si hay foto, leelo de la etiqueta.
- "semaforo": clasificacion general del producto en UNA palabra: "verde" (saludable o aceptable), "amarillo" (regular, consumo moderado) o "rojo" (poco saludable, p.ej. ultraprocesado con azucares anadidos, grasas trans/saturadas o sodio altos).
- "resumen": en 1-2 frases, que tan saludable es y para quien.
- "lo_bueno": aspectos positivos (nutrientes, fibra, proteina, etc.). Si casi no hay, dilo con honestidad.
- "lo_malo": ingredientes o componentes preocupantes (azucares anadidos, grasas trans o saturadas, sodio alto, aditivos, colorantes, ultraprocesamiento, etc.).
- "organos_afectados": que organos o sistemas se ven impactados por su consumo y como. Si el alimento es SALUDABLE, describe a que organos/sistemas AYUDA o beneficia; si es poco saludable, que puede afectar (corazon, higado, pancreas, dientes, huesos, digestion, peso/metabolismo, etc.).
- "alternativas_saludables": 2 a 4 alternativas mas saludables y concretas que pueden reemplazar este producto.

Si la imagen o el texto NO corresponde a un alimento o producto de consumo, devuelve {"error":"mensaje amable"}. Si no reconoces el producto, orienta de forma general por sus ingredientes y aclara que se consulte a un nutricionista.`;

const PROMPT_TEXTO = (texto) =>
  `Alimento o producto: "${texto}". Analizalo: componentes/ingredientes tipicos, lo bueno y lo malo, organos afectados y alternativas saludables.`;
const PROMPT_IMAGENES = (tipos) =>
  `Te envio ${tipos.length} foto(s) de un alimento o producto: ${tipos
    .map((t, i) => `(${i + 1}) ${t === 'nombre' ? 'el nombre/marca' : 'la lista de ingredientes o el alimento'}`)
    .join(', ')}. Analizalo y responde en el formato JSON indicado.`;

// ===== Prompts: PLANIFICADOR =====
// Reglas duras del planificador. Se comparten entre generar menu y regenerar, para que
// una regeneracion no pueda "olvidar" una alergia que el menu original si respetaba.
const REGLAS_PLANIFICADOR = `Eres un chef y nutricionista peruano. Planificas la comida REAL de una familia peruana: platos caseros, que se cocinan en una olla comun, con ingredientes que se consiguen en un mercado del Peru.

REGLAS INNEGOCIABLES:
1. ALERGIAS: jamas incluyas un ingrediente al que alguien del hogar sea alergico, ni en trazas, ni como acompañamiento, ni "opcional". No hay excepciones ni sustituciones "al gusto". Esto es lo mas importante de tu tarea.
2. CONDICIONES MEDICAS: adapta el plato de verdad (menos sal e hipertension, menos azucar y carbohidratos simples con diabetes, sin gluten con celiaquia, sin lacteos con intolerancia, etc.). No basta con advertir: cambia la receta.
3. DIETA: respeta la dieta del hogar (vegetariana = sin carne ni pescado; vegana = sin ningun producto animal; pescetariana = pescado si, carne no).
4. DESPENSA PRIMERO: prioriza SIEMPRE lo que la familia ya tiene. Un ingrediente con "tengo: poco" alcanza para un plato, no para varios; con "bastante" puedes repetirlo en la semana. Puedes incluir ingredientes que NO tenga, pero solo los justos y baratos, y debes listarlos como faltantes.
5. REGION: cocina del estilo de su region (costa, sierra o selva) y de su ciudad si la indican. Usa nombres de platos que esa familia reconozca.
6. VARIEDAD: no repitas el mismo plato en la semana. Varia proteinas y guarniciones.
7. MOMENTO: el desayuno peruano es ligero (pan, avena, quinua, huevo, fruta, emoliente); el almuerzo es la comida fuerte (entrada opcional + segundo con arroz/papa); la cena es liviana y facil.
8. PRESUPUESTO: "bajo" = platos economicos de olla; "alto" = puedes proponer cortes y pescados mas caros.`;

// El aporte nutricional (platos.info). Vive aparte porque lo comparten TRES flujos:
// generar el menu, regenerar una casilla y detallar platos viejos. Si cada uno tuviera su
// propia definicion, el mismo plato daria numeros distintos segun por donde se pidio.
const FORMATO_INFO = `- "info": el aporte nutricional APROXIMADO de UNA porcion, como objeto:
  { "calorias": <numero entero, kcal por porcion>,
    "carbohidratos": "alto" | "medio" | "bajo",
    "proteinas": "alto" | "medio" | "bajo",
    "grasas": "alto" | "medio" | "bajo",
    "destacados": [<hasta 3 vitaminas o minerales que este plato aporte de verdad, ej. "hierro", "vitamina A", "fibra">],
    "semaforo": "verde" | "ambar" | "rojo",
    "resumen": "<una frase corta: que aporta el plato y a quien le conviene>" }

  El "semaforo" mide que tan saludable es ESTE plato PARA ESTE HOGAR, y debes ser honesto aunque tu mismo lo hayas propuesto:
  - "verde": liviano y equilibrado, lo pueden comer sin cuidado.
  - "ambar": pesado, frito, muy calorico o alto en carbohidratos simples. Se puede comer, pero de vez en cuando.
  - "rojo": le hace daño a alguien del hogar por su condicion medica.
  Las calorias son una estimacion casera, no un calculo de laboratorio: no inventes precision.`;

// La receta. Vive aparte porque la comparten DOS flujos: generar el plato (viene incluida)
// y el backfill de platos viejos que nacieron sin ella. Misma razon que FORMATO_INFO: si
// cada flujo tuviera su definicion, el mismo plato daria recetas de distinta forma.
const FORMATO_PASOS = `- "pasos": array de strings con la receta, paso a paso y en orden. Reglas:
  - Entre 4 y 8 pasos. Cada uno, una frase corta con UNA accion concreta que la persona hace.
  - Cocina casera peruana de verdad: olla, sarten, licuadora. Nada de tecnicas ni utensilios de restaurante.
  - Usa los ingredientes y las cantidades que ya pusiste en "ingredientes". No metas ingredientes nuevos aqui.
  - Si adaptaste el plato por una condicion medica (menos sal, sin azucar, sin lacteos), que se note EN LOS PASOS, no solo en la nota.
  - Con hipertension en el hogar, nada de "sal al gusto": di cuanta.
  - NO numeres los pasos ("1.", "2.-"): el orden del array ya es el numero.`;

const FORMATO_PLATO = `Cada plato es un objeto JSON con:
- "nombre": nombre del plato como lo diria la familia (ej. "Ají de gallina", "Quinua atamalada").
- "ingredientes": array de { "nombre", "cantidad", "unidad" } con las cantidades YA ESCALADAS al numero de comensales del hogar. Usa unidades de mercado peruano (kg, g, unidad, taza, cucharada, atado, rama).
- "faltantes": array de strings con los nombres de los ingredientes que NO estan en su despensa y tendria que comprar. Si le alcanza con lo que tiene, devuelve [].
- "tiempo_min": minutos aproximados de preparacion (numero).
- "dificultad": "facil" | "media" | "dificil".
- "nota": una frase corta y util (por que le conviene a esta familia, o que cuidado tuvo con una condicion medica). Si adaptaste el plato por una condicion, DILO aqui.
${FORMATO_PASOS}
${FORMATO_INFO}
  Si tu propones el plato, el semaforo "rojo" casi nunca deberia aparecer: ya adaptaste el plato a sus condiciones.`;

// Generacion por casillas: el dia entero (3) o un plato suelto (1). Es el UNICO prompt de
// generacion del planificador — el usuario arma su semana dia por dia, no de un golpe.
//
// Por eso el prompt insiste tanto en lo que YA hay esa semana: al no ver el resto del
// calendario, la IA es "greedy" y sin estos datos repetiria platos y gastaria dos veces
// los mismos ingredientes escasos de la despensa.
const SYSTEM_CASILLAS = `${REGLAS_PLANIFICADOR}

Se te dara el contexto de un hogar, lo que YA tiene programado esa semana, y que casillas del calendario hay que llenar. Propon SOLO los platos pedidos.

Estas completando una semana que se arma POCO A POCO: las casillas que no se te piden ya tienen plato (algunos los eligio la familia a mano) y NO debes tocarlas. Tu trabajo es que lo que propongas ENCAJE con lo que ya hay.

${FORMATO_PLATO}

ADEMAS de los campos del plato, CADA entrada DEBE llevar la etiqueta de su casilla:
- "dia": el numero de dia de la casilla, tal cual se te pidio (0-6, 0=domingo).
- "momento": "desayuno" | "almuerzo" | "cena", tal cual se te pidio.
Sin estas dos etiquetas no sabemos en que casilla va cada plato y se descarta el trabajo. No las omitas.

Responde UNICAMENTE con un objeto JSON limpio:
{"platos":[{"dia":<0-6, 0=domingo>,"momento":"desayuno|almuerzo|cena", ...campos del plato...}, ...]}

Devuelve exactamente una entrada por cada casilla pedida, EN EL MISMO ORDEN en que se te pidieron. Los platos nuevos deben ser DISTINTOS a los que ya tiene esa semana (evita repetir) y distintos a los que se te pidan evitar.`;

// Backfill de platos ya existentes: les completa la receta (pasos) y/o el aporte
// nutricional (info) que les falte. NO propone platos nuevos ni los cambia. Por eso no
// repite las reglas del planificador (no hay nada que planificar), pero SI recibe el
// contexto del hogar: tanto el semaforo como las adaptaciones de la receta (menos sal,
// sin lacteos) dependen de las condiciones medicas de la familia, no del plato en abstracto.
//
// Cada plato dice en "necesita" que le falta: pedirle a la IA lo que el plato YA tiene
// seria pagar dos veces por lo mismo (y arriesgarse a que lo reescriba distinto).
const SYSTEM_DETALLE = `Eres un chef y nutricionista peruano.

Se te dara el contexto de un hogar y una lista de platos que YA estan en su calendario. Para CADA plato, COMPLETA lo que le falta. NO cambies el plato, no propongas otro, no corrijas sus ingredientes: solo completa.

Cada plato trae un campo "necesita" con lo que hay que calcular: "info", "pasos", o ambos. Devuelve SOLO los campos que ese plato pide: lo que no pide, ya lo tiene y se descartara.

${FORMATO_PASOS}
${FORMATO_INFO}

Responde UNICAMENTE con un objeto JSON limpio (sin texto antes/despues ni markdown):
{"platos":[{"id":<el id que se te dio, tal cual>,"info":{...},"pasos":[...]}, ...]}

Devuelve exactamente una entrada por cada plato que se te dio, con su "id" original.`;

const PROMPT_DETALLE = (ctxTexto, platos) =>
  `${ctxTexto}

PLATOS A ANALIZAR (usa el "id" tal cual en tu respuesta):
${JSON.stringify(platos)}`;

// comprometidos: [{ nombre, platos }] — ingredientes que los platos YA programados esa
// semana van a consumir, con en cuantos platos aparece cada uno.
//
// Es la pieza que compensa generar de a un dia. La regla 4 dice que un ingrediente con
// "tengo: poco" alcanza para UN plato: generando la semana entera de un golpe la IA
// repartia la despensa con vision global, pero de a un dia no ve que el lunes ya se gasto
// el pollo. Mandarle solo los NOMBRES de los platos no basta ("Aji de gallina" no le dice
// que comprometio el pollo): hay que darle los ingredientes.
const PROMPT_CASILLAS = (ctxTexto, casillas, yaEnLaSemana, comprometidos, evitar, extra) =>
  `${ctxTexto}

PLATOS QUE YA TIENE ESA SEMANA (no los repitas): ${JSON.stringify(yaEnLaSemana)}
${comprometidos && comprometidos.length
    ? `INGREDIENTES DE SU DESPENSA YA COMPROMETIDOS POR ESOS PLATOS: ${comprometidos.map((c) => `${c.nombre} (en ${c.platos} plato${c.platos > 1 ? 's' : ''})`).join(', ')}
Tenlo en cuenta al repartir la despensa: si un ingrediente lo tiene en "poco" y ya esta comprometido, no vuelvas a contar con el — trata ese ingrediente como faltante o usa otro.`
    : ''}
${evitar && evitar.length ? `NO PROPONGAS ESTOS (la familia los rechazo): ${JSON.stringify(evitar)}` : ''}

CASILLAS A LLENAR: ${JSON.stringify(casillas)}${extra ? `\n\nPEDIDO ADICIONAL DE LA FAMILIA: ${extra}` : ''}`;

// ===== Infraestructura comun =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Errores transitorios del proveedor: se reintentan con backoff.
function esTransitorio(e) {
  const s = `${e?.status || ''} ${e?.code || ''} ${e?.message || ''}`.toLowerCase();
  return /(^|\D)(429|503|529)(\D|$)/.test(s)
    || /unavailable|overloaded|high demand|rate.?limit/.test(s)
    || /respuesta vacia|no devolvio un json/.test(s); // respuestas vacias intermitentes del gateway
}

async function conReintentos(fn, intentos = 3) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try { return await fn(); }
    catch (e) {
      ultimo = e;
      if (!esTransitorio(e) || i === intentos - 1) throw e;
      await sleep(600 * (i + 1)); // backoff: 600ms, 1200ms
    }
  }
  throw ultimo;
}

// Extrae el primer objeto JSON de la respuesta del modelo de forma tolerante.
function parseJSON(texto) {
  if (!texto) throw new Error('Respuesta vacia de la IA');
  let limpio = texto.trim();
  limpio = limpio.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const inicio = limpio.indexOf('{');
  const fin = limpio.lastIndexOf('}');
  if (inicio === -1 || fin === -1) throw new Error('La IA no devolvio un JSON valido');
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

// ============================ Backend: Claude (Anthropic) ============================
function backendClaude() {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });
  const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const usage = (resp) => {
    const u = resp?.usage || {};
    return {
      input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      output: u.output_tokens || 0,
    };
  };

  // Une TODOS los bloques de texto. El gateway a veces antepone bloques "thinking"
  // (sin .text), por eso no se puede leer content[0] a ciegas.
  const textoDe = (resp) => (resp?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  const aContenido = (partes) =>
    partes.map((p) =>
      p.imagen
        ? { type: 'image', source: { type: 'base64', media_type: p.imagen.mediaType, data: p.imagen.base64 } }
        : { type: 'text', text: p.texto }
    );

  return {
    // Llama y parsea DENTRO del reintento, para recuperarse de respuestas vacias del gateway.
    pedir: (system, partes, maxTokens) =>
      conReintentos(async () => {
        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: maxTokens || 1600,
          system,
          messages: [{ role: 'user', content: aContenido(partes) }],
        });
        return { data: parseJSON(textoDe(resp)), usage: usage(resp) };
      }),
  };
}

// ============================ Backend: Gemini (Google) ============================
function backendGemini() {
  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  // Thinking desactivado: tareas acotadas, mas rapido y barato.
  // Nota: si cambias a gemini-2.5-pro, quita thinkingBudget (pro no lo permite).
  const cfg = (system, maxTokens) => ({
    systemInstruction: system,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
    ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
  });

  const usage = (resp) => {
    const u = resp?.usageMetadata || {};
    return {
      input: u.promptTokenCount || 0,
      output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    };
  };

  const aContenido = (partes) =>
    partes.map((p) => (p.imagen ? { inlineData: { mimeType: p.imagen.mediaType, data: p.imagen.base64 } } : { text: p.texto }));

  return {
    pedir: (system, partes, maxTokens) =>
      conReintentos(async () => {
        const resp = await client.models.generateContent({
          model: MODEL,
          contents: aContenido(partes),
          config: cfg(system, maxTokens),
        });
        return { data: parseJSON(resp.text), usage: usage(resp) };
      }),
  };
}

// ============================ Seleccion / fallback de proveedor ============================
let _claude, _gemini;
const getBackend = (p) => (p === 'gemini' ? (_gemini ||= backendGemini()) : (_claude ||= backendClaude()));

// Lee la configuracion de IA en runtime (el admin la edita en la tabla config).
function ordenProveedores() {
  let modo, prioridad;
  try {
    const { getConfig } = require('../db');
    modo = (getConfig('ai_modo') || '').toLowerCase();
    prioridad = (getConfig('ai_prioridad') || '').toLowerCase();
  } catch { /* sin BD: usar env */ }
  if (!modo) modo = ['gemini', 'claude', 'ambos'].includes(PROVIDER) ? PROVIDER : 'gemini';
  if (modo === 'gemini') return ['gemini'];
  if (modo === 'claude') return ['claude'];
  return prioridad === 'claude' ? ['claude', 'gemini'] : ['gemini', 'claude']; // ambos
}

// Punto UNICO de llamada: prueba el proveedor prioritario y, si falla, el siguiente.
// Devuelve { data, usage } con usage.proveedor = quien atendio (para el costo del admin).
async function pedir(system, partes, maxTokens) {
  const orden = ordenProveedores();
  let ultimo;
  for (const prov of orden) {
    try {
      const out = await getBackend(prov).pedir(system, partes, maxTokens);
      out.usage.proveedor = prov;
      return out;
    } catch (e) {
      ultimo = e;
      console.error(`[IA] fallo ${prov}: ${e.message}`);
    }
  }
  throw ultimo;
}

// ============================ Metodos de dominio ============================

// Escaner por nombre.
async function explicarPorTexto(texto) {
  const { data, usage } = await pedir(SYSTEM_ANALISIS, [{ texto: PROMPT_TEXTO(texto) }]);
  return { resultado: data, usage };
}

// Escaner por fotos. imagenes: [{ base64, mediaType, tipo: 'nombre'|'ingredientes' }]
// Las fotos van primero y el texto al final.
async function explicarPorImagen(imagenes) {
  const partes = imagenes.map((im) => ({ imagen: { base64: im.base64, mediaType: im.mediaType } }));
  partes.push({ texto: PROMPT_IMAGENES(imagenes.map((i) => i.tipo)) });
  const { data, usage } = await pedir(SYSTEM_ANALISIS, partes);
  return { resultado: data, usage };
}

// ===== Planificador =====
// Techo de tokens. Las respuestas del planificador son largas y con el default del
// proveedor el JSON llega cortado y el parseo falla.
//
// Este techo dejo de ser critico al pasar a generar UN DIA a la vez: un dia son 3 platos
// (~1.700 tokens de salida medidos) contra los ~11.500 del menu semanal completo que se
// generaba antes de un golpe. Aquel menu llego a estar al 96% de un techo de 12.000 y un
// JSON truncado tumbaba los 21 platos; hoy, en el peor caso, se pierde un dia.
// Se mantiene alto igualmente porque NO cuesta nada: solo se paga por los tokens que el
// modelo realmente genera. Es un seguro, no un gasto. Si le agregas campos al plato,
// vuelve a medir.
const MAX_TOKENS_PLANIFICADOR = 24000;

// Completa la receta (pasos) y/o el aporte nutricional (info) de platos que nacieron sin
// ellos, cuando el planificador todavia no los pedia. Los platos nuevos ya vienen
// completos y no pasan por aqui.
//
// EN BATCH a proposito: una semana son 21 platos y 21 llamadas sueltas costarian ~20x
// mas que una sola. Mismo criterio que verificarPlatos.
// platos: [{ id, nombre, ingredientes, porciones, necesita: ['info'|'pasos'] }]
//      -> { platos: [{ id, info?, pasos? }] }
async function detallarPlatos(ctxTexto, platos) {
  // 500 por plato: la receta (~250-300 tokens) pesa mas que la info sola (~120 medidos),
  // asi que los 220 de cuando esto solo calculaba nutricion se quedaban cortos.
  const { data, usage } = await pedir(
    SYSTEM_DETALLE,
    [{ texto: PROMPT_DETALLE(ctxTexto, platos) }],
    Math.min(MAX_TOKENS_PLANIFICADOR, 800 + platos.length * 500)
  );
  return { resultado: data, usage };
}

// Propone los platos de unas casillas concretas: el dia entero (3) o un plato suelto (1).
// Es la UNICA via de generacion del planificador — no existe "generar la semana completa"
// de un golpe, el usuario arma su semana dia por dia.
//
// comprometidos importa mas de lo que parece: al generar de a un dia, la IA no ve el resto
// de la semana y podria gastar dos veces el mismo "tengo: poco" de la despensa. Ver
// PROMPT_CASILLAS.
//
// casillas: [{ dia, momento }] ; yaEnLaSemana: [nombres] ; comprometidos: [{nombre, platos}]
// evitar: [nombres rechazados]
async function generarPlatos(ctxTexto, casillas, yaEnLaSemana, comprometidos, evitar, extra) {
  const { data, usage } = await pedir(
    SYSTEM_CASILLAS,
    [{ texto: PROMPT_CASILLAS(ctxTexto, casillas, yaEnLaSemana, comprometidos, evitar, extra) }],
    // 1400 por casilla. Fue subiendo con lo que trae el plato: ~350 tokens medidos cuando
    // era solo la receta base, ~550 al sumarle el aporte nutricional (info) y ~900 al
    // sumarle los pasos de preparacion. Con los 700 de antes, pedir un dia (3 platos) se
    // habria truncado y NO se pierde un plato: se pierde el JSON entero de la llamada.
    // Si le agregas campos al plato, MIDE otra vez (SELECT output_tokens FROM generaciones).
    Math.min(MAX_TOKENS_PLANIFICADOR, 1200 + casillas.length * 1400)
  );
  return { resultado: data, usage };
}

console.log(`[IA] Proveedor por defecto: ${PROVIDER} (configurable en admin: ai_modo/ai_prioridad)`);

module.exports = {
  explicarPorTexto,
  explicarPorImagen,
  generarPlatos,
  detallarPlatos,
  // Base para el metodo que falta (fase 4): verificarPlatos.
  pedir,
};
