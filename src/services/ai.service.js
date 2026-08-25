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
4. DESPENSA PRIMERO: prioriza SIEMPRE lo que la familia ya tiene. Cada producto de su despensa dice cuanto le "queda" en porcentaje: con 20% o menos alcanza para un plato, no para varios; con 70% o mas puedes repetirlo en la semana; con 0% se le acabo y cuenta como que NO lo tiene. Puedes incluir ingredientes que NO tenga, pero solo los justos y baratos, y debes listarlos como faltantes.
5. REGION Y CIUDAD: cocina del estilo de su region (costa, sierra o selva). Si indican CIUDAD, apoyate en ella de verdad: propon platos tipicos de esa ciudad o de su departamento, con el nombre con el que se conocen alli, y con los ingredientes que se consiguen en su mercado. Usa nombres de platos que esa familia reconozca.
6. VARIEDAD: no repitas el mismo plato en la semana. Varia proteinas y guarniciones.
7. MOMENTO: el desayuno peruano es ligero (pan, avena, quinua, huevo, fruta, emoliente); el almuerzo es la comida fuerte (entrada opcional + segundo con arroz/papa); la cena es liviana y facil.
8. PRESUPUESTO: "bajo" = platos economicos de olla; "alto" = puedes proponer cortes y pescados mas caros.
9. PETICIONES DE LA FAMILIA: el bloque "PETICIONES DE LA FAMILIA" son instrucciones que escribio el propio usuario. NO son una preferencia vaga: CUMPLELAS en TODOS los platos a los que apliquen, no solo en algunos.
   - Si piden un acompañamiento o una bebida (ensalada, refresco, infusion, sopa de entrada), va DENTRO del plato: nombralo en el titulo o en los ingredientes Y en los pasos. Un plato que no lo incluya se considera mal hecho.
   - Si piden algo sobre el conjunto del dia (por ejemplo, cena ligera si el almuerzo fue pesado), aplicalo mirando las otras casillas del mismo dia.
   - Si evitan un alimento ("no nos gusta el pescado"), no lo propongas.
   - Solo hay una excepcion: si una peticion choca con una alergia o una condicion medica, mandan la alergia y la condicion, y lo explicas en el campo "nota" del plato.`;

// El aporte nutricional (platos.info). Vive aparte porque lo comparten TRES flujos:
// generar el menu, regenerar una casilla y detallar platos viejos. Si cada uno tuviera su
// propia definicion, el mismo plato daria numeros distintos segun por donde se pidio.
const FORMATO_INFO = `- "info": el aporte nutricional APROXIMADO de UNA porcion, como objeto:
  { "calorias": <numero, kcal por porcion>,
    "nutrientes": {
      "carbohidratos": { "v": <gramos>, "vd": <% del valor diario> },
      "proteinas":     { "v": <gramos>, "vd": <%> },
      "grasas":        { "v": <gramos>, "vd": <%> },
      "fibra":         { "v": <gramos>, "vd": <%> },
      "hierro":        { "v": <miligramos>, "vd": <%> },
      "sodio":         { "v": <miligramos>, "vd": <%> },
      "sal":           { "v": <gramos de equivalente en sal>, "vd": <%> }
    },
    "carbohidratos": "alto" | "medio" | "bajo",
    "proteinas": "alto" | "medio" | "bajo",
    "grasas": "alto" | "medio" | "bajo",
    "destacados": [<hasta 3 vitaminas o minerales que este plato aporte de verdad, ej. "hierro", "vitamina A", "fibra">],
    "recomendaciones": [<hasta 3 frases, UNA POR INTEGRANTE que lo necesite, diciendo su NOMBRE y que debe tener en cuenta con ESTE plato por su condicion medica o su edad. Si a nadie le aplica, deja []>],
    "semaforo": "verde" | "ambar" | "rojo",
    "resumen": "<una frase corta: que aporta el plato y a quien le conviene>" }

  Sobre "nutrientes":
  - "v" es la cantidad POR PORCION en la unidad indicada (gramos, o miligramos para hierro y sodio).
  - "vd" es el porcentaje del valor diario de referencia de un adulto (2000 kcal), redondeado.
  - El "eq. de sal" es el sodio convertido a sal: sal(g) = sodio(mg) x 2.5 / 1000.
  - Manten la coherencia con "calorias": 4 kcal por gramo de carbohidrato y de proteina, 9 por gramo de grasa.
  - Las etiquetas alto/medio/bajo se conservan y deben concordar con los numeros.

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

// "consume" = que porcion de LO QUE LA FAMILIA NECESITA DE ESE PRODUCTO EN UNA SEMANA se
// lleva este plato. Es lo que hace bajar la barra de la despensa.
//
// EL ANCLA ES LA NECESIDAD, NO EL ENVASE (cambio del 2026-07-29). Antes el 100% era "el
// envase lleno de una casa peruana", y con esa referencia los numeros no cuadraban con nada:
// un consume 90 de arroz no queria decir "se lleva el 90% de lo que necesitas esta semana",
// queria decir "se lleva el 90% de tu bolsa". Con la necesidad como ancla el modelo CIERRA y
// es comprobable: cocinar todo lo planificado del periodo deja cada producto cerca de 0%, y
// la barra por fin responde la pregunta con la que el usuario entra a esa pantalla ("¿me
// alcanza?"). Ver "Consumo de la despensa" en CLAUDE.md.
//
// SIEMPRE se pide sobre UNA SEMANA, aunque la compra cubra varias: es una unidad que la IA
// sabe estimar y mantiene los numeros en un rango con resolucion (5-50). Dividir por las
// semanas del periodo lo hace el backend (services/consumo.js) — pidiendolo sobre 12
// semanas, la parte de un plato seria ~1% y la barra no se moveria.
//
// La alternativa era una heuristica local por categoria, que es la que sigue usandose de
// respaldo para los platos que nacieron sin este campo (ver services/consumo.js). No basta
// sola: sin la IA, la sal y el aceite bajarian igual que la carne y una semana normal
// dejaria los condimentos en rojo. Este campo viaja en la MISMA llamada que el plato, asi
// que no cuesta una generacion extra de cupo.
const FORMATO_CONSUME = `  El "consume" de cada ingrediente es un ENTERO 0-100 y su escala es LA NECESIDAD SEMANAL, no el envase: el 100% de un producto es TODO lo que esta familia necesita de ese producto para UNA SEMANA de comidas. Cuanto se lleva este plato al cocinarlo una vez.
  - La regla practica: piensa en cuantos platos de la semana de esta familia usan ese producto y reparte 100 entre ellos. Si el arroz entra en unos 5 almuerzos, un almuerzo se lleva ~20. Si la sal entra en casi los 21 platos, un plato se lleva ~5.
  - Por eso los condimentos y los abarrotes salen BAJOS (2-15): no porque el envase sea grande, sino porque entran en muchos platos. Las carnes, pescados y legumbres salen ALTOS (30-50): entran en pocos platos de la semana y ahi se acaban.
  - Es por SEMANA aunque la familia haya comprado para varias: no ajustes el numero por el largo del periodo, eso se calcula aparte.
  - Si el ingrediente esta en "faltantes" (no lo tiene), pon 0: no hay stock del que descontar.
  - Si de ese producto le queda poco, NO subas ni bajes el numero por eso: "consume" es cuanto PIDE el plato, no cuanto hay.`;

const FORMATO_PLATO = `Cada plato es un objeto JSON con:
- "nombre": nombre del plato como lo diria la familia (ej. "Ají de gallina", "Quinua atamalada").
- "ingredientes": array de { "nombre", "cantidad", "unidad", "consume" } con las cantidades YA ESCALADAS al numero de comensales del hogar. Usa unidades de mercado peruano (kg, g, unidad, taza, cucharada, atado, rama).
${FORMATO_CONSUME}
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

Devuelve exactamente una entrada por cada casilla pedida, EN EL MISMO ORDEN en que se te pidieron.

NO REPETIR es una regla dura, no una preferencia:
- Ningun plato nuevo puede ser igual a uno que ya tiene esa semana, ni a los que se te pidan evitar.
- MENOS AUN en dias seguidos: nadie quiere el mismo almuerzo lunes y martes. Si dos casillas pedidas son del mismo momento, que sean platos claramente distintos entre si.
- Tampoco vale cambiar solo el nombre: "pollo al horno" y "pollo asado" cuentan como el mismo plato. Cambia la proteina, el metodo de coccion o el tipo de plato.`;

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

Cada plato trae un campo "necesita" con lo que hay que calcular: "info", "pasos", "consume" o varios. Devuelve SOLO los campos que ese plato pide: lo que no pide, ya lo tiene y se descartara.

${FORMATO_PASOS}
${FORMATO_INFO}
- "consume": array de { "nombre", "consume" } con UNA entrada por cada ingrediente del plato, con el nombre TAL CUAL se te dio (no lo reescribas ni cambies las cantidades: solo estas poniendole un numero a cada uno).
${FORMATO_CONSUME}

Responde UNICAMENTE con un objeto JSON limpio (sin texto antes/despues ni markdown):
{"platos":[{"id":<el id que se te dio, tal cual>,"info":{...},"pasos":[...],"consume":[{"nombre":"...","consume":<0-100>}, ...]}, ...]}

Devuelve exactamente una entrada por cada plato que se te dio, con su "id" original.`;

const PROMPT_DETALLE = (ctxTexto, platos) =>
  `${ctxTexto}

PLATOS A ANALIZAR (usa el "id" tal cual en tu respuesta):
${JSON.stringify(platos)}`;

// ===== Verificacion de platos PROPUESTOS POR EL USUARIO (fase 4) =====
// La direccion inversa del planificador: el usuario escribe "aji de gallina" y la IA le
// dice si le alcanza con lo que tiene. Aqui la IA NO elige el plato — lo eligio la familia.
//
// EL EMPAREJAMIENTO ingrediente<->despensa LO HACE LA IA, no un LIKE en SQL. Ya le mandamos
// la despensa en el mismo prompt, y sabe que "pechuga" cubre "pollo", que el chuño es papa
// seca y que el aji amarillo no es aji panca. Medido: con "Arroz" y "Leche" en la despensa
// marco "arroz integral" y "leche sin lactosa" como FALTANTES, porque el arroz blanco no
// le sirve al diabetico del hogar ni la leche normal al intolerante. Un LIKE habria dicho
// "ya lo tienes" y le habria servido leche a quien no puede tomarla.
const FORMATO_COBERTURA = `Para CADA plato devuelve un objeto con:
- "nombre": el plato, con el nombre normalizado y bien escrito (el usuario puede escribir "aji d gallina").
- "reconocido": true | false. false SOLO si no puedes identificar que plato es (texto sin sentido). Si es un plato real que no conoces al dedillo, usa tu mejor criterio y pon true.
- "ingredientes": array de { "nombre", "cantidad", "unidad", "consume" } con las cantidades YA ESCALADAS a los comensales del hogar. Es la receta REAL del plato, no la que quisieras.
${FORMATO_CONSUME}
- "tengo": array de strings — los ingredientes que SI estan cubiertos por su despensa.
- "faltantes": array de strings — los que NO tiene y debe comprar. [] si le alcanza con todo.
- "veredicto": "alcanza" (tiene todo) | "alcanza_justo" (tiene todo pero algo esta en "poco" y podria no rendir) | "falta_comprar" (le falta al menos un ingrediente).
- "advertencias": array de strings. Aqui va lo IMPORTANTE para la salud de este hogar:
  - Si el plato lleva un ALERGENO de la familia, la primera advertencia debe decirlo de frente y sin rodeos, nombrando al integrante concreto. NO adaptes el plato en silencio: el usuario pidio ESE plato y tiene derecho a saber que no le conviene.
  - Si choca con una condicion medica (diabetes, hipertension...), dilo y sugiere el cambio concreto.
  - [] si no hay nada que advertir.
- "nota": una frase corta con el consejo mas util para prepararlo en esta casa. null si no aporta nada.
${FORMATO_PASOS}
${FORMATO_INFO}

Al decidir "tengo" vs "faltantes", usa el criterio de un cocinero, no un buscador de texto:
- Un ingrediente de la despensa cubre al del plato si sirve DE VERDAD para cocinarlo (si tiene "pollo", cubre "pechuga de pollo").
- PERO si la condicion medica del hogar exige una version distinta de la que tiene (arroz integral cuando solo tiene arroz blanco; leche sin lactosa cuando solo tiene leche), eso es un FALTANTE, no algo que ya tiene.
- Un producto del que le quede poco (20% o menos) cuenta como que lo tiene, pero si el plato necesita bastante, dilo en "veredicto": "alcanza_justo". Con 0% se le acabo: eso es un FALTANTE.`;

const SYSTEM_VERIFICAR = `${REGLAS_PLANIFICADOR}

Se te dara el contexto de un hogar y una lista de platos que LA FAMILIA quiere cocinar. Tu tarea NO es proponer platos ni cambiarlos por otros: es decirles, para cada uno, que necesitan y si les alcanza con lo que tienen en casa.

Respeta el plato que te piden. Si el plato no le conviene a alguien del hogar, NO lo sustituyas por otro: proponlo tal cual y AVISA en "advertencias". La familia decide; tu informas.

${FORMATO_COBERTURA}

Responde UNICAMENTE con un objeto JSON limpio (sin texto antes/despues ni markdown):
{"platos":[{"pedido":"<el texto EXACTO que escribio el usuario, tal cual>", ...campos de arriba...}, ...]}

Devuelve exactamente una entrada por cada plato pedido, EN EL MISMO ORDEN, con su "pedido" original para poder emparejarlas.`;

const PROMPT_VERIFICAR = (ctxTexto, pedidos) =>
  `${ctxTexto}

PLATOS QUE LA FAMILIA QUIERE COCINAR (devuelve "pedido" tal cual para cada uno):
${JSON.stringify(pedidos)}`;

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
  // 650 por plato: la receta (~250-300 tokens) pesa mas que la info sola (~120 medidos),
  // asi que los 220 de cuando esto solo calculaba nutricion se quedaban cortos. Los ultimos
  // 150 son el "consume" del backfill (~10 ingredientes x ~12 tokens).
  const { data, usage } = await pedir(
    SYSTEM_DETALLE,
    [{ texto: PROMPT_DETALLE(ctxTexto, platos) }],
    Math.min(MAX_TOKENS_PLANIFICADOR, 800 + platos.length * 650)
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
    // 1600 por casilla. Fue subiendo con lo que trae el plato: ~350 tokens medidos cuando
    // era solo la receta base, ~550 al sumarle el aporte nutricional (info) y ~900 al
    // sumarle los pasos de preparacion. Con los 700 de antes, pedir un dia (3 platos) se
    // habria truncado y NO se pierde un plato: se pierde el JSON entero de la llamada.
    // El salto 1400 -> 1600 fue el "consume" por ingrediente (~10 tokens x ~10 ingredientes).
    // El salto 1600 -> 2000 es el aporte nutricional DETALLADO: 7 nutrientes con valor y % del
    // valor diario (~105 tokens) mas las recomendaciones por integrante (~90). Subir el techo no
    // cuesta nada (solo se paga lo generado); truncarse cuesta la llamada entera.
    // Si le agregas campos al plato, MIDE otra vez (SELECT output_tokens FROM generaciones).
    Math.min(MAX_TOKENS_PLANIFICADOR, 1200 + casillas.length * 2000)
  );
  return { resultado: data, usage };
}

// Verifica platos que propone EL USUARIO: que lleva cada uno, si le alcanza con su
// despensa y que advertencias medicas tiene para este hogar.
//
// EN BATCH a proposito: de 1 a 21 platos en UNA llamada. 21 llamadas sueltas costarian
// ~20x mas (el contexto del hogar se repetiria entero cada vez). Mismo criterio que
// detallarPlatos.
// pedidos: [string] (lo que escribio el usuario) -> { platos: [{ pedido, ...cobertura }] }
async function verificarPlatos(ctxTexto, pedidos) {
  const { data, usage } = await pedir(
    SYSTEM_VERIFICAR,
    [{ texto: PROMPT_VERIFICAR(ctxTexto, pedidos) }],
    // 1600 por plato, igual que generarPlatos: la respuesta trae lo mismo (ingredientes,
    // receta, info) mas la cobertura y las advertencias.
    Math.min(MAX_TOKENS_PLANIFICADOR, 1200 + pedidos.length * 1600)
  );
  return { resultado: data, usage };
}

// ===== ANALISIS DE CONSUMO =====
//
// Mira HACIA ATRAS: que comio esta familia en un rango de fechas y que le dice eso. Es el unico
// flujo que no propone platos, asi que NO hereda REGLAS_PLANIFICADOR (que habla de proponer y
// de la despensa): heredarlas empujaba a la IA a "arreglar" el pasado proponiendo un menu nuevo.
//
// Los NUMEROS los calcula el backend (suma de lo que ya esta en platos.info). A la IA se le pide
// solo lo que un numero no puede dar: interpretarlos para ESTE hogar o ESTA persona. Pedirle que
// sume seria pagar por aritmetica y arriesgar que invente cifras que no cuadran con la pantalla.
const SYSTEM_CONSUMO = `Eres un nutricionista peruano que revisa lo que una familia comio en un periodo y se lo explica en lenguaje claro, sin tecnicismos y sin asustar.

COMO TRABAJAS:
- Los numeros ya estan calculados y te los damos hechos. NO los recalcules ni los contradigas: interpretalos.
- OJO CON LA UNIDAD: el promedio es POR PERSONA Y POR DIA, no el total de la familia. Cada plato aporta lo de UNA porcion, asi que "1800 kcal al dia" significa que cada miembro comio eso, no los cuatro juntos. No digas "poco para cuatro personas".
- Habla de comida real y peruana ("cambia parte del arroz por quinua", "agrega sangrecita una vez por semana"), no de nutrientes abstractos.
- Se honesto: si algo esta bien, dilo. Si todo saliera "mal" o todo "perfecto", el analisis no serviria de nada.
- Si el analisis es de UNA persona, hablale de ELLA por su nombre y segun su edad y sus condiciones medicas. Si es de la familia, habla del conjunto y nombra a quien deba tener un cuidado especial.
- Ten en cuenta cuantas comidas hay registradas: si son pocas, los promedios diarios se quedan cortos y hay que decirlo en vez de concluir que la familia come poco.
- Las condiciones medicas y las alergias mandan sobre cualquier otra consideracion.
- No diagnostiques ni receta nada. Recomienda consultar a un profesional cuando corresponda.

DEVUELVE SOLO JSON valido con esta forma:
{
  "resumen": "<2 a 4 frases: que se comio en el periodo y como estuvo>",
  "veredicto": "bien" | "atencion" | "riesgo",
  "nutrientes": {
    "calorias":      { "estado": "bajo"|"adecuado"|"alto", "comentario": "<por que, con el numero delante>", "sugerencia": "<que hacer, concreto>" },
    "carbohidratos": { "estado": ..., "comentario": ..., "sugerencia": ... },
    "proteinas":     { ... },
    "grasas":        { ... },
    "fibra":         { ... },
    "hierro":        { ... },
    "sodio":         { ... }
  },
  "alimentos": [ { "nombre": "<uno de los alimentos de la lista>", "comentario": "<que aporta y si conviene subirlo o bajarlo en ESTE hogar>" } ],
  "faltan": [ "<grupo de alimentos que casi no aparece en el periodo, ej. 'pescado', 'menestras', 'fruta'>" ],
  "sugerencias": [ "<accion concreta para el proximo periodo>" ],
  "alertas": [ "<solo si una condicion medica o una alergia lo justifica; nombra a la persona>" ]
}
En "alimentos" comenta como maximo 6, los mas presentes. En "sugerencias", entre 3 y 6. "alertas" y "faltan" pueden ir vacios.`;

// datos: el resumen YA CALCULADO (ventana, comidas, nutrientes por dia, alimentos, platos).
// ambito: { tipo: 'familia' | 'integrante', ... } — de quien es el analisis.
async function analizarConsumo(ctxTexto, datos, ambito) {
  const prompt = [
    ctxTexto,
    '',
    ambito.tipo === 'integrante'
      ? `ANALIZA PARA UNA SOLA PERSONA: ${JSON.stringify(ambito)}. La familia come los mismos platos, asi que los alimentos son los del hogar; lo que cambia es si le convienen A ELLA por su edad y sus condiciones.`
      : 'ANALIZA PARA TODA LA FAMILIA en conjunto.',
    '',
    `LO QUE COMIERON EN EL PERIODO (ya calculado, no lo recalcules): ${JSON.stringify(datos)}`,
    '',
    'Devuelve SOLO el JSON pedido.',
  ].join('\n');

  // 2500 tokens: 7 nutrientes con comentario y sugerencia (~1.100) + resumen, alimentos,
  // sugerencias y alertas. Medido: cabe con holgura y truncarse costaria la llamada entera.
  const { data, usage } = await pedir(SYSTEM_CONSUMO, [{ texto: prompt }], 2500);
  return { resultado: data, usage };
}

console.log(`[IA] Proveedor por defecto: ${PROVIDER} (configurable en admin: ai_modo/ai_prioridad)`);

// Propone platos NUEVOS para la biblioteca del usuario (no para una casilla del calendario).
//
// Se le pasan los que YA tiene para que no los repita: es la unica forma de que "proponme algo"
// no devuelva por tercera vez el mismo aji de gallina. Y NO se le manda la despensa aunque el
// hogar la use: un plato de la biblioteca es una receta que se guarda para reutilizar mas
// adelante, no una propuesta para cocinar hoy con lo que queda en casa.
async function proponerPlatosBiblioteca(ctxTexto, cuantos, yaTiene, momento) {
  const n = Math.max(1, Math.min(3, parseInt(cuantos, 10) || 1));
  const pedido = [
    ctxTexto,
    '',
    `TAREA: propon ${n} plato(s) NUEVO(S) para la biblioteca de recetas de esta familia.`,
    momento ? `Deben servir para: ${momento}.` : 'Pueden ser de cualquier momento del dia.',
    yaTiene.length
      ? `YA TIENE ESTOS EN SU BIBLIOTECA (NO los repitas ni propongas variantes casi iguales): ${yaTiene.join(', ')}`
      : 'Su biblioteca esta vacia.',
    '',
    'Son recetas para GUARDAR y reutilizar: elige platos ricos, de su region y realistas para su',
    'presupuesto. No mires ninguna despensa: lista los ingredientes que el plato necesita.',
    '',
    REGLAS_PLANIFICADOR,
    '',
    'Devuelve SOLO un JSON: { "platos": [ { ... } ] }, y cada plato con:',
    FORMATO_PLATO,
  ].join('\n');

  const { data, usage } = await pedir(
    SYSTEM_CASILLAS,
    [{ texto: pedido }],
    Math.min(MAX_TOKENS_PLANIFICADOR, 1200 + n * 2000)
  );
  return { resultado: data, usage };
}

module.exports = {
  analizarConsumo,
  proponerPlatosBiblioteca,
  explicarPorTexto,
  explicarPorImagen,
  generarPlatos,
  detallarPlatos,
  verificarPlatos,
  pedir,
};
