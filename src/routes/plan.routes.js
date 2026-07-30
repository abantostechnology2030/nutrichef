// Rutas del PLAN DE COMIDAS: el calendario semanal (7 dias x desayuno/almuerzo/cena)
// y la generacion de platos con IA a partir del hogar + la despensa.
//
// LA UNIDAD DE GENERACION ES EL DIA, NO LA SEMANA. El usuario arma su calendario poco a
// poco: pide un dia (3 platos) o un plato suelto, cuando quiere, y el resto lo puede
// llenar a mano con platos de su biblioteca. No existe "generar la semana completa": ese
// boton existia y se elimino a proposito, porque reemplazaba la semana entera y le habria
// borrado al usuario los platos que eligio a mano.
//
// Costo: TODA llamada a IA de aqui se registra en la tabla "generaciones" (tokens +
// proveedor). Sirve para dos cosas a la vez: el tope por plan (generaciones_max por
// semana) y el costo real en el panel admin. No agregar una llamada a IA sin registrarla.
const express = require('express');
const {
  db, lunesDe, fechaPeru, sumarDias, periodoDe, claveIng, quitarTildes, clampPct, nivelDePorcentaje,
  MOMENTOS, DIAS, DIA_NUM, CATEGORIAS_ING,
} = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador, requiereHogar } = require('../middleware/planificador');
const { contextoDe, textoContexto } = require('../services/contexto');
const { consumoDeCasillaId } = require('../services/consumo');
const { generarPlatos, detallarPlatos, verificarPlatos } = require('../services/ai.service');

const router = express.Router();
router.use(requiereAuth, requierePlanificador);

// DIA_NUM (orden lunes..domingo sobre el 0=Domingo de la BD) vive en db.js: lo comparten
// el calendario y el descuento de la despensa, y tienen que mapear el domingo igual.
const semanaActual = () => lunesDe(fechaPeru());

// ===== Limites del plan =====

// Semanas distintas programables (semanas_max). Devuelve true si programar en `semana`
// superaria el tope y esa semana aun no tiene nada.
function semanaBloqueada(usuarioId, semana, max) {
  if (max == null) return false;
  const yaExiste = db.prepare('SELECT 1 FROM plan_comidas WHERE usuario_id = ? AND semana = ? LIMIT 1').get(usuarioId, semana);
  if (yaExiste) return false;
  const n = db.prepare('SELECT COUNT(DISTINCT semana) c FROM plan_comidas WHERE usuario_id = ?').get(usuarioId).c;
  return n >= max;
}

// Generaciones de IA usadas en una semana concreta del plan.
const generacionesUsadas = (usuarioId, semana) =>
  db.prepare('SELECT COUNT(*) c FROM generaciones WHERE usuario_id = ? AND semana = ?').get(usuarioId, semana).c;

// Registra el consumo de IA. Es la unica via por la que se anota el gasto del planificador.
function registrarGeneracion(usuarioId, semana, tipo, usage = {}) {
  db.prepare('INSERT INTO generaciones (usuario_id, semana, tipo, input_tokens, output_tokens, proveedor) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuarioId, semana, tipo, usage.input || 0, usage.output || 0, usage.proveedor || null);
}

// Verifica el cupo ANTES de llamar a la IA (no tiene sentido gastar y luego rechazar).
function cupoAgotado(usuario, semana) {
  const max = usuario.generaciones_max;
  if (max == null) return null;
  const usadas = generacionesUsadas(usuario.id, semana);
  if (usadas < max) return null;
  return {
    error: `Tu plan permite ${max} generacion(es) de IA por semana. Pasa a un plan superior para generar mas.`,
    upgrade: true,
    redirect: '/mi-plan.html',
  };
}

// ===== Lectura del plan =====

function platoPublico(f) {
  return {
    id: f.p_id,
    nombre: f.p_nombre,
    momento: f.p_momento,
    porciones: f.p_porciones,
    ingredientes: JSON.parse(f.p_ingredientes || '[]'),
    faltantes: JSON.parse(f.p_faltantes || '[]'),
    pasos: f.p_pasos ? JSON.parse(f.p_pasos) : null,
    info: f.p_info ? JSON.parse(f.p_info) : null,
    nota: f.p_nota,
    tiempo_min: f.p_tiempo,
    dificultad: f.p_dificultad,
    origen: f.p_origen,
    guardado: !!f.p_guardado,
  };
}

function itemsDe(usuarioId, where, args) {
  return db.prepare(
    `SELECT pc.id, pc.dia, pc.momento, pc.semana, pc.comensales, pc.cocinado, pc.cobertura, pc.verificado_en,
            p.id AS p_id, p.nombre AS p_nombre, p.momento AS p_momento, p.porciones AS p_porciones,
            p.ingredientes AS p_ingredientes, p.faltantes AS p_faltantes, p.pasos AS p_pasos,
            p.info AS p_info, p.nota AS p_nota, p.tiempo_min AS p_tiempo, p.dificultad AS p_dificultad,
            p.origen AS p_origen, p.guardado AS p_guardado
     FROM plan_comidas pc JOIN platos p ON p.id = pc.plato_id
     WHERE pc.usuario_id = ? ${where}
     ORDER BY pc.dia, pc.momento`
  ).all(usuarioId, ...args).map((f) => ({
    id: f.id,
    dia: f.dia,
    momento: f.momento,
    semana: f.semana,
    comensales: f.comensales,
    cocinado: !!f.cocinado,
    cobertura: f.cobertura ? JSON.parse(f.cobertura) : null,
    verificado_en: f.verificado_en,
    plato: platoPublico(f),
  }));
}

// Plan de una semana como matriz dia -> momento -> item (o null si la casilla esta vacia).
function planSemana(usuarioId, semana) {
  const plan = {};
  for (const d of DIA_NUM) {
    plan[d] = {};
    for (const m of MOMENTOS) plan[d][m] = null;
  }
  for (const it of itemsDe(usuarioId, 'AND pc.semana = ?', [semana])) plan[it.dia][it.momento] = it;
  return plan;
}

// GET /api/plan?semana=YYYY-MM-DD -> el calendario de esa semana + estado de los limites
router.get('/', (req, res) => {
  const semana = lunesDe(req.query.semana);
  res.json({
    semana,
    semana_actual: semanaActual(),
    dias: DIAS,
    dia_orden: DIA_NUM,
    momentos: MOMENTOS,
    plan: planSemana(req.usuario.id, semana),
    hogar_configurado: req.usuario.hogar_configurado,
    limites: {
      generaciones_max: req.usuario.generaciones_max,
      generaciones_usadas: generacionesUsadas(req.usuario.id, semana),
      semanas_max: req.usuario.semanas_max,
      semanas_usadas: db.prepare('SELECT COUNT(DISTINCT semana) c FROM plan_comidas WHERE usuario_id = ?').get(req.usuario.id).c,
    },
  });
});

// GET /api/plan/semanas -> semanas que ya tienen programacion (para copiar de una a otra)
router.get('/semanas', (req, res) => {
  res.json({
    semanas: db.prepare('SELECT semana, COUNT(*) AS items FROM plan_comidas WHERE usuario_id = ? GROUP BY semana ORDER BY semana DESC')
      .all(req.usuario.id),
  });
});

// ===== Lista de faltantes del periodo (Fase 5) =====
// La promesa central: "los faltantes de AMBAS direcciones se consolidan en UNA sola lista".
//   1. platos.faltantes        -> lo que la IA marco como no disponible AL GENERAR.
//   2. plan_comidas.cobertura  -> lo que arrojo VERIFICAR un plato propuesto por el usuario.
// Se juntan, se DEDUPLICAN (misma cebolla en varios platos, con distinta grafia) y se
// agrupan por categoria del catalogo para leerla EN EL MERCADO (por pasillo, no por plato).
// NO usa IA: son datos que ya estan en la BD.

// claveIng (la normalizacion que deduplica "Tomates" con "tomate") vive en db.js: la
// comparten esta lista, el cruce con el catalogo y el descuento de la despensa, y las tres
// tienen que agrupar igual o el mismo producto seria uno o dos segun quien lo mire.

// Fecha real (YYYY-MM-DD) de una casilla: dia 0=Domingo (BD) -> offset lunes..domingo.
const fechaCasilla = (semana, dia) => sumarDias(semana, DIA_NUM.indexOf(dia));

// ===== Cuanto hay que comprar de cada faltante =====
//
// Las cantidades YA estaban en platos.ingredientes (la IA devuelve cantidad + unidad por
// ingrediente) y la lista de compras las tiraba: te mandaba al mercado con "manzana" a secas
// cuando en la BD decia "2 unidades" en un plato y "1 unidad" en otro. Sumarlas no cuesta una
// llamada de IA ni un campo nuevo.
//
// Unidades: se unifica SOLO lo que es la misma medida escrita de otra forma ("g"/"gramos",
// "ramita"/"rama"). NUNCA se convierte entre medidas distintas: una taza de arroz pesa ~185 g
// y una de harina ~120, asi que "taza -> g" necesitaria una tabla POR INGREDIENTE y
// equivocarse ahi seria un error silencioso en la cara del usuario. Si un ingrediente viene en
// dos unidades, se muestran las dos ("500 g + 2 tazas") en vez de inventar una suma.
//
// Los plurales van explicitos en la tabla y NO por claveIng: su singular es "simple" y
// convierte "dientes" en "dient" (no en "diente"), que es justo el caso de la mitad de las
// recetas peruanas. Para nombres de ingrediente da igual (compara clave contra clave); para
// unidades, no.
const UNIDAD_CANON = {
  g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  l: 'l', lt: 'l', litro: 'l', litros: 'l',
  taza: 'taza', tazas: 'taza',
  cda: 'cucharada', cucharada: 'cucharada', cucharadas: 'cucharada',
  cdta: 'cucharadita', cucharadita: 'cucharadita', cucharaditas: 'cucharadita',
  unidad: 'unidad', unidades: 'unidad', und: 'unidad', u: 'unidad',
  diente: 'diente', dientes: 'diente',
  atado: 'atado', atados: 'atado', manojo: 'atado', manojos: 'atado',
  rama: 'rama', ramas: 'rama', ramita: 'rama', ramitas: 'rama',
  rebanada: 'rebanada', rebanadas: 'rebanada', tajada: 'rebanada', tajadas: 'rebanada',
  rodaja: 'rodaja', rodajas: 'rodaja',
  porcion: 'porcion', porciones: 'porcion',
  trozo: 'trozo', trozos: 'trozo', presa: 'presa', presas: 'presa',
  pizca: 'pizca', pizcas: 'pizca',
  hoja: 'hoja', hojas: 'hoja',
  lata: 'lata', latas: 'lata',
  sobre: 'sobre', sobres: 'sobre',
  paquete: 'paquete', paquetes: 'paquete',
};
// Plural para MOSTRAR. Los simbolos (g, kg, ml, l) no se pluralizan nunca: "500 gs" no existe.
const UNIDAD_PLURAL = {
  taza: 'tazas', cucharada: 'cucharadas', cucharadita: 'cucharaditas', unidad: 'unidades',
  diente: 'dientes', atado: 'atados', rama: 'ramas', rebanada: 'rebanadas', trozo: 'trozos',
  rodaja: 'rodajas', porcion: 'porciones', presa: 'presas', pizca: 'pizcas', hoja: 'hojas',
  lata: 'latas', sobre: 'sobres', paquete: 'paquetes',
};

// La IA escribe "unidad mediana", "unidades grandes", "trozo pequeño": el calificativo de
// tamaño no cambia la medida y si impide agrupar, asi que se descarta.
const TAMANOS = /\b(mediana?s?|grandes?|chica?s?|peque[nñ]a?o?s?|extra)\b/g;
function unidadCanon(u) {
  const original = quitarTildes(u).toLowerCase().trim();
  const limpio = original.replace(TAMANOS, '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
  // La IA a veces pone SOLO el tamaño como unidad ("1 mediana", "2 medianas" — visto en
  // produccion). Al quitar el calificativo no queda nada, pero lo que quiso decir es "1 unidad
  // mediana": son piezas contables. Si el campo venia vacio de origen, se respeta vacio (un
  // numero suelto, sin unidad, no se convierte en piezas por nuestra cuenta).
  if (!limpio) return original ? 'unidad' : '';
  return UNIDAD_CANON[limpio] || limpio; // una unidad que no conocemos se respeta tal cual
}

const numFmt = (n) => String(Math.round(n * 100) / 100);

// Suma -> texto para el mercado. Unica conversion permitida: g->kg y ml->l a partir de 1000,
// porque el factor es exacto y es como lo diria una persona ("1.5 kg", no "1500 g").
function textoMedida(porUnidad) {
  const partes = [];
  for (const [unidad, total] of porUnidad) {
    if (!(total > 0)) continue;
    let n = total;
    let u = unidad;
    if (u === 'g' && n >= 1000) { n /= 1000; u = 'kg'; }
    else if (u === 'ml' && n >= 1000) { n /= 1000; u = 'l'; }
    const etiqueta = n === 1 ? u : (UNIDAD_PLURAL[u] || u);
    partes.push(`${numFmt(n)} ${etiqueta}`.trim());
  }
  return partes.length ? partes.join(' + ') : null;
}

// GET /api/plan/faltantes?inicio=&fin=   |   ?compra_id=   |   ?semana=
// Sin parametros: la semana actual. La ventana puede cruzar varias semanas ISO.
router.get('/faltantes', (req, res) => {
  const usuario = req.usuario;

  // Resolver la ventana [inicio, fin]. Prioridad: compra_id > inicio/fin > semana > actual.
  let inicio;
  let fin;
  if (req.query.compra_id) {
    const c = db.prepare('SELECT periodo_inicio, periodo_fin, semana FROM compras WHERE id = ? AND usuario_id = ?')
      .get(Number(req.query.compra_id), usuario.id);
    if (!c) return res.status(404).json({ error: 'Compra no encontrada.' });
    inicio = c.periodo_inicio || c.semana;
    fin = c.periodo_fin || sumarDias(inicio, 6);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.inicio || '')) {
    inicio = req.query.inicio;
    fin = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fin || '') ? req.query.fin : sumarDias(inicio, 6);
  } else {
    const p = periodoDe('semanal', req.query.semana);
    inicio = p.inicio;
    fin = p.fin;
  }
  if (fin < inicio) [inicio, fin] = [fin, inicio];

  // Todas las casillas del usuario con sus faltantes (generado) y su cobertura (propuesto).
  // Se traen tambien los INGREDIENTES del plato: son los que llevan cantidad + unidad, y los
  // faltantes son solo nombres. Es de donde sale "cuanto comprar".
  const filas = db.prepare(
    `SELECT pc.semana, pc.dia, pc.cobertura, p.faltantes AS p_faltantes, p.ingredientes AS p_ingredientes
     FROM plan_comidas pc JOIN platos p ON p.id = pc.plato_id
     WHERE pc.usuario_id = ?`
  ).all(usuario.id);

  // Catalogo -> categoria, indexado por la misma clave para tolerar plurales/grafia.
  const catMap = new Map();
  for (const r of db.prepare('SELECT nombre, categoria FROM ingredientes_catalogo').all()) {
    catMap.set(claveIng(r.nombre), r.categoria);
  }

  // Consolidar deduplicando. Se conserva el PRIMER nombre visto (mejor grafia) y se
  // acumulan las fuentes (generado / propuesto) de las que vino el faltante.
  const acc = new Map(); // clave -> { nombre, categoria, fuentes:Set, casillas, porUnidad:Map }
  const sumar = (nombre, fuente, ing) => {
    const limpio = String(nombre || '').trim();
    if (!limpio) return;
    const k = claveIng(limpio);
    if (!k) return;
    let e = acc.get(k);
    if (!e) {
      e = { nombre: limpio, categoria: catMap.get(k) || 'otro', fuentes: new Set(), casillas: 0, porUnidad: new Map() };
      acc.set(k, e);
    }
    e.fuentes.add(fuente);
    e.casillas++;
    // La cantidad puede faltar (platos manuales, o la IA que la omitio): esa aparicion no
    // suma nada y las demas si. Sumar un 0 fingido daria un total mas bajo que la verdad,
    // que es peor que no decir nada — el usuario compraria de menos.
    const n = Number(ing?.cantidad);
    if (!Number.isFinite(n) || n <= 0) return;
    const u = unidadCanon(ing?.unidad);
    e.porUnidad.set(u, (e.porUnidad.get(u) || 0) + n);
  };

  for (const f of filas) {
    if (!(fechaCasilla(f.semana, f.dia) >= inicio && fechaCasilla(f.semana, f.dia) <= fin)) continue;

    // Indice de los ingredientes de ESTE plato por la misma clave que los faltantes: el
    // faltante dice "Arroz integral" y el ingrediente tambien, pero por si acaso se compara
    // normalizado (es lo que hace el resto de la app).
    const ings = new Map();
    for (const i of JSON.parse(f.p_ingredientes || '[]')) {
      const k = claveIng(String(i?.nombre || ''));
      if (k && !ings.has(k)) ings.set(k, i);
    }
    const conCantidad = (nombre) => ings.get(claveIng(String(nombre || '')));

    for (const x of JSON.parse(f.p_faltantes || '[]')) sumar(x, 'generado', conCantidad(x));
    if (f.cobertura) {
      try { for (const x of JSON.parse(f.cobertura).faltantes || []) sumar(x, 'propuesto', conCantidad(x)); }
      catch { /* cobertura corrupta: se ignora, no debe tumbar la lista */ }
    }
  }

  const items = [...acc.values()]
    .map((e) => ({
      nombre: e.nombre,
      categoria: e.categoria,
      casillas: e.casillas,
      fuentes: [...e.fuentes],
      // medida = ya listo para pintar ("3 unidades", "500 g + 2 tazas"); null si ningun plato
      // traia cantidad. cantidades = el desglose, por si un cliente quiere formatearlo distinto.
      medida: textoMedida(e.porUnidad),
      cantidades: [...e.porUnidad].map(([unidad, cantidad]) => ({ unidad, cantidad: Math.round(cantidad * 100) / 100 })),
    }))
    .sort((a, b) => CATEGORIAS_ING.indexOf(a.categoria) - CATEGORIAS_ING.indexOf(b.categoria) || a.nombre.localeCompare(b.nombre));

  // Agrupado por categoria en el orden del catalogo (= orden de pasillo del mercado).
  const por_categoria = CATEGORIAS_ING
    .map((cat) => ({ categoria: cat, items: items.filter((i) => i.categoria === cat) }))
    .filter((g) => g.items.length);

  res.json({ inicio, fin, total: items.length, items, por_categoria });
});

// ===== Aporte nutricional (platos.info) =====

// Niveles y semaforo son enums: la IA es un modelo de lenguaje y a veces responde
// "medio-alto" o "amarillo". Se normaliza aqui y lo que no encaje cae a null, para que
// el front nunca tenga que adivinar (y no pinte un chip con un valor inventado).
const NIVEL_NUTRI = ['alto', 'medio', 'bajo'];
const SEMAFOROS = ['verde', 'ambar', 'rojo'];

const normNivelNutri = (v) => {
  const s = String(v || '').toLowerCase().trim();
  return NIVEL_NUTRI.find((n) => s.startsWith(n)) || null;
};

const normSemaforo = (v) => {
  const s = String(v || '').toLowerCase().trim();
  if (s.startsWith('amarill')) return 'ambar'; // sinonimo frecuente en las respuestas
  return SEMAFOROS.find((x) => s.startsWith(x)) || null;
};

// Normaliza la receta que devuelve la IA -> JSON listo para platos.pasos, o null.
// NULL significa "sin receta todavia" y es lo que dispara el backfill (igual que info).
// Se le quita la numeracion manual ("1.", "2)-") porque el front ya los pinta en un <ol>:
// sin esto salia "1. 1. Sancochar el pollo".
function normPasos(pasos) {
  if (!Array.isArray(pasos)) return null;
  const limpios = pasos
    .map((p) => String(p || '').trim().replace(/^\s*\d+\s*[.)-]+\s*/, '').trim())
    .filter(Boolean)
    .map((p) => p.slice(0, 300))
    .slice(0, 12);
  return limpios.length ? JSON.stringify(limpios) : null;
}

// Devuelve el JSON listo para guardar en platos.info, o null si la IA no mando nada
// aprovechable. NULL significa "sin analizar todavia" y es lo que dispara el backfill.
function normInfo(info) {
  if (!info || typeof info !== 'object') return null;

  const cal = Number(info.calorias);
  const limpio = {
    calorias: Number.isFinite(cal) && cal > 0 ? Math.round(cal) : null,
    carbohidratos: normNivelNutri(info.carbohidratos),
    proteinas: normNivelNutri(info.proteinas),
    grasas: normNivelNutri(info.grasas),
    destacados: (Array.isArray(info.destacados) ? info.destacados : [])
      .map((d) => String(d).trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 3),
    semaforo: normSemaforo(info.semaforo),
    resumen: info.resumen ? String(info.resumen).trim().slice(0, 300) : null,
  };

  // Si no quedo ni un dato util, es como si no hubiera venido.
  const vacio = !limpio.calorias && !limpio.carbohidratos && !limpio.proteinas
    && !limpio.grasas && !limpio.destacados.length && !limpio.semaforo && !limpio.resumen;
  return vacio ? null : JSON.stringify(limpio);
}

// ===== Generacion =====

// Convierte un plato de la IA en una fila de "platos". Tolerante: la IA a veces
// devuelve un string donde esperamos un array, y perder el menu entero por eso seria peor.
// origen: 'ia' = lo propuso el planificador ; 'propuesto' = lo pidio el usuario por nombre
// y la IA solo lo verifico (ver POST /verificar).
// Normaliza los ingredientes que devuelve la IA. Lo unico que se valida de verdad es
// "consume" (0-100), porque es el que MUEVE la despensa: si llega como "80%" o como texto,
// se descarta y el ingrediente cae a la heuristica por categoria en vez de descontar un
// NaN. Ausente y 0 son cosas distintas: 0 es "no gasta nada de esto", y se respeta.
function normIngredientes(v) {
  return (Array.isArray(v) ? v : []).map((ing) => {
    const limpio = { ...ing };
    const c = Number(ing?.consume);
    if (Number.isFinite(c)) limpio.consume = clampPct(c);
    else delete limpio.consume;
    return limpio;
  });
}

// Backfill del "consume" sobre los ingredientes que YA tiene el plato (ver /detallar).
// Solo AGREGA el numero: el nombre, la cantidad y la unidad se quedan tal cual estaban. Es
// deliberado — la receta del plato es dato del usuario y ya la vio; lo que falta es el peso
// que mueve la barra de la despensa. Si la IA renombra un ingrediente, se ignora.
//
// El emparejamiento es por nombre normalizado (claveIng, el mismo de consumo.js) y no por
// posicion: la IA reordena la lista con facilidad, y aplicarle a la sal el consume del pollo
// vaciaria la despensa sin que el usuario tenga como notarlo.
//
// Devuelve el JSON a guardar, o null si no hubo nada que completar.
function fusionarConsume(ings, respuesta) {
  const porClave = new Map();
  for (const r of Array.isArray(respuesta) ? respuesta : []) {
    const clave = claveIng(String(r?.nombre || ''));
    const c = Number(r?.consume);
    if (clave && Number.isFinite(c)) porClave.set(clave, clampPct(c));
  }
  if (!porClave.size) return null;

  let cambio = false;
  const fusionados = ings.map((ing) => {
    if (Number.isFinite(Number(ing?.consume))) return ing; // ya lo tenia: no se pisa
    const c = porClave.get(claveIng(String(ing?.nombre || '')));
    if (c === undefined) return ing;
    cambio = true;
    return { ...ing, consume: c };
  });
  return cambio ? JSON.stringify(fusionados) : null;
}

function crearPlato(usuarioId, p, momento, comensales, region, origen = 'ia') {
  const lista = (v) => (Array.isArray(v) ? v : []);
  const nombre = String(p?.nombre || '').trim().slice(0, 120);
  if (!nombre) return null;

  const dificultad = ['facil', 'media', 'dificil'].includes(p?.dificultad) ? p.dificultad : null;
  const fila = db.prepare(
    `INSERT INTO platos (usuario_id, nombre, momento, porciones, ingredientes, faltantes, nota, pasos, info, tiempo_min, dificultad, region, origen, guardado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    usuarioId, nombre, momento, comensales,
    JSON.stringify(normIngredientes(p?.ingredientes)),
    JSON.stringify(lista(p?.faltantes).map((f) => String(f))),
    p?.nota ? String(p.nota).slice(0, 300) : null,
    normPasos(p?.pasos),
    normInfo(p?.info),
    Number.isFinite(p?.tiempo_min) ? Math.max(0, Math.round(p.tiempo_min)) : null,
    dificultad, region, origen
  );
  return fila.lastInsertRowid;
}

// Coloca un plato en una casilla. La casilla es UNIQUE(usuario,semana,dia,momento):
// si ya habia algo, se reemplaza (y el plato viejo se limpia si nadie mas lo usa).
function ponerEnCasilla(usuarioId, semana, dia, momento, platoId, comensales) {
  const previo = db.prepare('SELECT * FROM plan_comidas WHERE usuario_id = ? AND semana = ? AND dia = ? AND momento = ?')
    .get(usuarioId, semana, dia, momento);
  if (previo) {
    // Si la casilla que se reemplaza ya estaba cocinada, hay que devolverle a la despensa
    // lo que le descontó: el plato desaparece del calendario y con el su registro de
    // consumo_aplicado, asi que este es el ultimo momento para revertirlo.
    if (previo.cocinado) revertirConsumo(usuarioId, previo);
    db.prepare('DELETE FROM plan_comidas WHERE usuario_id = ? AND semana = ? AND dia = ? AND momento = ?').run(usuarioId, semana, dia, momento);
  }

  db.prepare('INSERT INTO plan_comidas (usuario_id, semana, dia, momento, plato_id, comensales) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuarioId, semana, dia, momento, platoId, comensales);

  if (previo) limpiarPlatoHuerfano(usuarioId, previo.plato_id);
}

// Un plato generado que ya no esta en ningun plan y que el usuario no guardo en su
// biblioteca no le sirve a nadie: se borra para no acumular basura.
function limpiarPlatoHuerfano(usuarioId, platoId) {
  const p = db.prepare('SELECT guardado, origen FROM platos WHERE id = ? AND usuario_id = ?').get(platoId, usuarioId);
  if (!p || p.guardado) return;
  const enUso = db.prepare('SELECT 1 FROM plan_comidas WHERE plato_id = ? LIMIT 1').get(platoId);
  if (!enUso) db.prepare('DELETE FROM platos WHERE id = ?').run(platoId);
}

// Ingredientes que los platos YA programados de esa semana van a consumir, deduplicados y
// con en cuantos platos aparece cada uno.
//
// Es lo que compensa generar de a un dia. Generando la semana completa de un golpe, la IA
// repartia la despensa entre los 21 platos con vision global; de a un dia no ve el resto
// del calendario y podria gastar dos veces el mismo "tengo: poco". Mandarle los NOMBRES de
// los platos no alcanza: "Aji de gallina" no le dice que el pollo ya esta comprometido.
//
// Se mandan solo nombres + conteo, no cantidades: es lo que necesita la regla 4 del prompt
// ("poco alcanza para un plato") y cuesta ~10x menos tokens que el JSON de ingredientes
// completo de hasta 20 platos.
function ingredientesComprometidos(items, excluir = []) {
  const cuenta = new Map();
  for (const it of items) {
    if (excluir.some((c) => c.dia === it.dia && c.momento === it.momento)) continue; // la casilla se va a reemplazar
    const vistos = new Set();
    for (const ing of it.plato.ingredientes) {
      const nombre = String(ing?.nombre || '').trim();
      if (!nombre) continue;
      const clave = nombre.toLowerCase();
      if (vistos.has(clave)) continue; // no contar dos veces el mismo ingrediente de un plato
      vistos.add(clave);
      const prev = cuenta.get(clave);
      if (prev) prev.platos++;
      else cuenta.set(clave, { nombre, platos: 1 });
    }
  }
  return [...cuenta.values()].sort((a, b) => b.platos - a.platos);
}

// POST /api/plan/generar { semana, casillas: [{dia, momento}], evitar?, extra? }
// Genera los platos de las casillas pedidas: el dia entero (3) o un plato suelto (1).
//
// Es la UNICA ruta de generacion del planificador. Antes habia ademas un /generar que
// armaba la semana completa (21 platos) de una sola llamada; se elimino porque reemplazaba
// TODA la semana y borraba los platos que el usuario habia puesto a mano.
//
// La ruta reemplaza las casillas que se le pidan, esten vacias u ocupadas: decidir cuales
// mandar es del cliente (la UI llena las vacias y pide confirmacion antes de pisar las
// ocupadas). Aqui se cobra 1 generacion por llamada, sea 1 plato o 3.
router.post('/generar', requiereHogar, async (req, res) => {
  const semana = lunesDe(req.body?.semana);
  const usuario = req.usuario;

  const casillas = (Array.isArray(req.body?.casillas) ? req.body.casillas : [])
    .map((c) => ({ dia: parseInt(c?.dia, 10), momento: String(c?.momento || '') }))
    .filter((c) => c.dia >= 0 && c.dia <= 6 && MOMENTOS.includes(c.momento))
    .slice(0, 3);
  if (!casillas.length) return res.status(400).json({ error: 'Indica que casillas quieres generar.' });

  if (semanaBloqueada(usuario.id, semana, usuario.semanas_max)) {
    return res.status(403).json({
      error: `Tu plan permite programar ${usuario.semanas_max} semana(s). Pasa a un plan superior para programar mas.`,
      upgrade: true, redirect: '/mi-plan.html',
    });
  }
  const sinCupo = cupoAgotado(usuario, semana);
  if (sinCupo) return res.status(403).json(sinCupo);

  const ctx = contextoDe(usuario.id);
  if (!ctx || !ctx.integrantes.length) {
    return res.status(409).json({ error: 'Configura tu hogar antes de generar platos.', necesita_hogar: true, redirect: '/hogar.html' });
  }
  if (!ctx.despensa.length) {
    return res.status(409).json({
      error: 'Tu despensa esta vacia. Registra tu compra para que podamos proponerte platos con lo que tienes.',
      necesita_despensa: true, redirect: '/despensa.html',
    });
  }

  // Lo que ya hay esa semana, para que no repita ni gaste dos veces la despensa; y lo que
  // se esta reemplazando, para que no lo vuelva a proponer.
  const actuales = itemsDe(usuario.id, 'AND pc.semana = ?', [semana]);
  const enLaSemana = actuales.map((it) => it.plato.nombre);
  const comprometidos = ingredientesComprometidos(actuales, casillas);
  const rechazados = [
    ...(Array.isArray(req.body?.evitar) ? req.body.evitar.map(String) : []),
    ...actuales.filter((it) => casillas.some((c) => c.dia === it.dia && c.momento === it.momento)).map((it) => it.plato.nombre),
  ];

  let resultado, usage;
  try {
    ({ resultado, usage } = await generarPlatos(
      textoContexto(ctx), casillas, enLaSemana, comprometidos, rechazados, String(req.body?.extra || '').slice(0, 300)
    ));
  } catch (e) {
    console.error('Error IA (generar):', e.message);
    return res.status(502).json({ error: 'No pudimos generar los platos. Intenta nuevamente en un momento.' });
  }
  // El gasto se registra aunque el JSON venga raro: la IA ya cobro esos tokens.
  registrarGeneracion(usuario.id, semana, casillas.length > 1 ? 'dia' : 'plato', usage);

  if (resultado?.error) return res.status(502).json({ error: String(resultado.error) });
  const platos = Array.isArray(resultado?.platos) ? resultado.platos : null;
  if (!platos || !platos.length) return res.status(502).json({ error: 'La IA no devolvio platos validos. Intenta nuevamente.' });

  // Empareja cada casilla pedida con el plato que le corresponde. Dos vias, en orden:
  //   1. Por etiqueta: la IA marca cada plato con su "dia" y "momento" (lo pide el prompt).
  //   2. Por POSICION: si falta la etiqueta, el plato i-esimo es el de la casilla i-esima.
  //
  // La via 2 no es paranoia: Claude devuelve los platos correctos y EN ORDEN, pero sin las
  // etiquetas (sigue FORMATO_PLATO al pie de la letra, y alli no figuran). Gemini si las
  // pone. Emparejando solo por etiqueta, un dia entero con Claude descartaba los 3 platos
  // buenos y respondia 502 — mientras que pedir 1 plato funcionaba, porque habia un
  // "|| platos[0]" que lo salvaba. El prompt es una PETICION, no una garantia: el momento
  // real de la casilla lo pone crearPlato() desde `c.momento`, no desde lo que diga la IA.
  function platoDe(indice, casilla, usados) {
    const porEtiqueta = platos.findIndex((x, i) =>
      !usados.has(i) && Number(x?.dia) === casilla.dia && x?.momento === casilla.momento);
    if (porEtiqueta !== -1) return porEtiqueta;
    return !usados.has(indice) && platos[indice] ? indice : -1;
  }

  const tx = db.transaction(() => {
    let n = 0;
    const usados = new Set();
    casillas.forEach((c, i) => {
      const idx = platoDe(i, c, usados);
      if (idx === -1) return;
      usados.add(idx);
      const platoId = crearPlato(usuario.id, platos[idx], c.momento, ctx.hogar.comensales, ctx.hogar.region);
      if (!platoId) return; // casilla que la IA no devolvio: se deja como estaba, no se rompe el resto
      ponerEnCasilla(usuario.id, semana, c.dia, c.momento, platoId, ctx.hogar.comensales);
      n++;
    });
    return n;
  });
  const creados = tx();
  if (!creados) return res.status(502).json({ error: 'La IA no devolvio platos para esas casillas. Intenta nuevamente.' });

  res.status(201).json({
    mensaje: creados === 1 ? 'Plato generado.' : `${creados} platos generados.`,
    creados,
    semana,
    plan: planSemana(usuario.id, semana),
    limites: { generaciones_max: usuario.generaciones_max, generaciones_usadas: generacionesUsadas(usuario.id, semana) },
  });
});

// POST /api/plan/detallar { semana } -> completa la RECETA (platos.pasos), el aporte
// nutricional (platos.info) y/o el "consume" de los ingredientes de los platos de esa
// semana a los que les falte.
//
// Es SOLO backfill: los platos que genera el planificador ya nacen con las tres cosas y no
// pasan por aqui. Existe para los generados antes de que se pidieran esos campos (se
// sumaron en tres tandas: primero la nutricion, luego la receta, luego el consume, asi que
// hay platos con unas y sin otras). Si no falta nada, responde sin llamar a la IA (y sin
// consumir cupo): no se cobra por no hacer nada.
//
// El "consume" esta aqui porque sin el la barra de la despensa cae a la heuristica por
// categoria, que no distingue una cucharadita de aji de medio kilo de pollo (ver
// services/consumo.js). Es el unico campo del backfill que MUEVE datos del usuario.
router.post('/detallar', requiereHogar, async (req, res) => {
  const semana = lunesDe(req.body?.semana);
  const usuario = req.usuario;

  // Solo los de ESTA semana a los que les falte algo. Un plato es estable: una vez
  // calculados, ni su receta ni su aporte ni su consume cambian, asi que esto es cache
  // gratis para siempre.
  //
  // Que le falta el consume se decide en JS y no en el WHERE: vive DENTRO del JSON de
  // ingredientes (un campo por ingrediente), y meter json_each en la consulta para esto
  // seria mas fragil que leer las filas de una semana, que son 21 como maximo.
  //
  // "Le falta el consume" = NINGUN ingrediente lo tiene, no "alguno no lo tiene". Con
  // "alguno" bastaria que la IA omitiera un ingrediente de la lista para que el plato
  // quedara pendiente PARA SIEMPRE: el boton "Completar platos" no se apagaria nunca y cada
  // clic costaria una generacion de cupo sin arreglar nada. Un plato que ya paso por aqui se
  // da por hecho, y lo que la IA no puntuo se queda con la heuristica por categoria — que es
  // exactamente donde estaba antes, asi que no se pierde nada.
  const sinConsume = (ings) => ings.length > 0 && ings.every((i) => !Number.isFinite(Number(i?.consume)));
  const pendientes = db.prepare(
    `SELECT DISTINCT p.id, p.nombre, p.porciones, p.ingredientes, p.faltantes, p.pasos, p.info
       FROM plan_comidas pc
       JOIN platos p ON p.id = pc.plato_id
      WHERE pc.usuario_id = ? AND pc.semana = ?`
  ).all(usuario.id, semana)
    .map((p) => ({ ...p, ings: JSON.parse(p.ingredientes || '[]') }))
    .map((p) => ({ ...p, sinConsume: sinConsume(p.ings) }))
    .filter((p) => !p.info || !p.pasos || p.sinConsume);

  if (!pendientes.length) {
    return res.json({ mensaje: 'Todos los platos de esta semana ya estan completos.', detallados: 0, semana });
  }

  const sinCupo = cupoAgotado(usuario, semana);
  if (sinCupo) return res.status(403).json(sinCupo);

  const ctx = contextoDe(usuario.id);
  if (!ctx || !ctx.integrantes.length) {
    return res.status(409).json({ error: 'Configura tu hogar antes de completar los platos.', necesita_hogar: true, redirect: '/hogar.html' });
  }

  // A la IA le mandamos lo minimo para trabajar (nombre, porciones, ingredientes) y, en
  // "necesita", QUE le falta a cada plato: pedirle lo que el plato ya tiene seria pagar
  // dos veces y arriesgar que lo reescriba distinto.
  // Los "faltantes" van porque la regla del consume los necesita: de un ingrediente que la
  // familia no tiene no hay stock que descontar, asi que ese va en 0.
  const paraIA = pendientes.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    porciones: p.porciones,
    ingredientes: p.ings,
    faltantes: JSON.parse(p.faltantes || '[]'),
    necesita: [!p.info ? 'info' : null, !p.pasos ? 'pasos' : null, p.sinConsume ? 'consume' : null].filter(Boolean),
  }));

  let resultado, usage;
  try {
    ({ resultado, usage } = await detallarPlatos(textoContexto(ctx), paraIA));
  } catch (e) {
    console.error('Error IA (detalle):', e.message);
    return res.status(502).json({ error: 'No pudimos analizar los platos. Intenta nuevamente en un momento.' });
  }
  registrarGeneracion(usuario.id, semana, 'detalle', usage);

  if (resultado?.error) return res.status(502).json({ error: String(resultado.error) });
  const lista = Array.isArray(resultado?.platos) ? resultado.platos : null;
  if (!lista) return res.status(502).json({ error: 'La IA no devolvio un analisis valido. Intenta nuevamente.' });

  // Solo se aceptan ids que estaban en el pedido: la IA no puede tocar otros platos.
  // Y solo se escribe lo que al plato le FALTABA: si la IA devuelve de mas (p.ej. una
  // receta para un plato que ya la tenia), se ignora en vez de pisar lo que ya estaba.
  const porId = new Map(pendientes.map((p) => [p.id, p]));
  let detallados = 0;
  const tx = db.transaction(() => {
    for (const item of lista) {
      const id = parseInt(item?.id, 10);
      const pendiente = porId.get(id);
      if (!pendiente) continue;

      const campos = [];
      const valores = [];
      if (!pendiente.info) {
        const info = normInfo(item?.info);
        if (info) { campos.push('info = ?'); valores.push(info); }
      }
      if (!pendiente.pasos) {
        const pasos = normPasos(item?.pasos);
        if (pasos) { campos.push('pasos = ?'); valores.push(pasos); }
      }
      if (pendiente.sinConsume) {
        const ings = fusionarConsume(pendiente.ings, item?.consume);
        if (ings) { campos.push('ingredientes = ?'); valores.push(ings); }
      }
      if (!campos.length) continue;

      db.prepare(`UPDATE platos SET ${campos.join(', ')} WHERE id = ? AND usuario_id = ?`).run(...valores, id, usuario.id);
      detallados++;
    }
  });
  tx();

  res.json({
    mensaje: detallados ? `${detallados} plato(s) completados.` : 'La IA no pudo completar estos platos.',
    detallados,
    semana,
    plan: planSemana(usuario.id, semana),
    limites: { generaciones_max: usuario.generaciones_max, generaciones_usadas: generacionesUsadas(usuario.id, semana) },
  });
});

// ===== Verificacion de platos propuestos por el usuario (fase 4) =====

// Normaliza la cobertura que devuelve la IA -> JSON para plan_comidas.cobertura.
// Vive en plan_comidas y NO en platos a proposito: el plato es estable, lo que cambia es
// la despensa. El mismo "aji de gallina" puede alcanzar esta semana y faltar la otra.
const VEREDICTOS = ['alcanza', 'alcanza_justo', 'falta_comprar'];

// maxLen NO es un detalle: los nombres de ingredientes son cortos, pero una ADVERTENCIA es
// una frase entera ("PELIGRO: lleva mani, que es un alergeno absoluto para Luis"). Con el
// tope de 80 que sirve para un ingrediente, la advertencia salia cortada a media palabra
// ("...alergeno absoluto para L") — justo el mensaje que no se puede recortar. Ya paso.
const listaTexto = (v, max = 40, maxLen = 80) =>
  (Array.isArray(v) ? v : []).map((x) => String(x || '').trim().slice(0, maxLen)).filter(Boolean).slice(0, max);

function normCobertura(p) {
  const tengo = listaTexto(p?.tengo);
  const faltantes = listaTexto(p?.faltantes);
  const advertencias = listaTexto(p?.advertencias, 6, 400);
  // Si la IA manda un veredicto raro, se deduce de los faltantes en vez de descartarlo.
  const veredicto = VEREDICTOS.includes(p?.veredicto)
    ? p.veredicto
    : (faltantes.length ? 'falta_comprar' : 'alcanza');
  return JSON.stringify({ tengo, faltantes, advertencias, veredicto });
}

// POST /api/plan/verificar { semana, casillas: [{dia, momento, nombre}] }
// La 3a via para llenar una casilla: el usuario ESCRIBE el plato que quiere cocinar y la
// IA le dice que lleva, si le alcanza con su despensa y que cuidados tiene para su hogar.
//
// Es la direccion inversa del planificador (despensa -> IA -> platos). Aqui la familia
// elige y la IA informa: NUNCA sustituye el plato pedido por otro que le convenga mas —
// si no le conviene, lo dice en "advertencias" y la familia decide.
//
// EN BATCH: de 1 a 21 platos en una sola llamada = una sola generacion de cupo.
router.post('/verificar', requiereHogar, async (req, res) => {
  const semana = lunesDe(req.body?.semana);
  const usuario = req.usuario;

  const casillas = (Array.isArray(req.body?.casillas) ? req.body.casillas : [])
    .map((c) => ({
      dia: parseInt(c?.dia, 10),
      momento: String(c?.momento || ''),
      nombre: String(c?.nombre || '').trim().slice(0, 120),
    }))
    .filter((c) => c.dia >= 0 && c.dia <= 6 && MOMENTOS.includes(c.momento) && c.nombre)
    .slice(0, 21);
  if (!casillas.length) return res.status(400).json({ error: 'Escribe el nombre del plato que quieres cocinar.' });

  if (semanaBloqueada(usuario.id, semana, usuario.semanas_max)) {
    return res.status(403).json({
      error: `Tu plan permite programar ${usuario.semanas_max} semana(s). Pasa a un plan superior para programar mas.`,
      upgrade: true, redirect: '/mi-plan.html',
    });
  }
  const sinCupo = cupoAgotado(usuario, semana);
  if (sinCupo) return res.status(403).json(sinCupo);

  const ctx = contextoDe(usuario.id);
  if (!ctx || !ctx.integrantes.length) {
    return res.status(409).json({ error: 'Configura tu hogar antes de verificar platos.', necesita_hogar: true, redirect: '/hogar.html' });
  }

  let resultado, usage;
  try {
    ({ resultado, usage } = await verificarPlatos(textoContexto(ctx), casillas.map((c) => c.nombre)));
  } catch (e) {
    console.error('Error IA (verificar):', e.message);
    return res.status(502).json({ error: 'No pudimos verificar el plato. Intenta nuevamente en un momento.' });
  }
  registrarGeneracion(usuario.id, semana, 'verificar', usage);

  if (resultado?.error) return res.status(502).json({ error: String(resultado.error) });
  const analizados = Array.isArray(resultado?.platos) ? resultado.platos : null;
  if (!analizados || !analizados.length) return res.status(502).json({ error: 'La IA no pudo analizar ese plato. Intenta nuevamente.' });

  // Mismo criterio que en /generar: primero por etiqueta ("pedido"), y si la IA no la
  // devolvio, por POSICION. Ver la nota de platoDe() — el prompt es una peticion, no una
  // garantia, y no vamos a tirar un analisis bueno por una etiqueta que falta.
  const tx = db.transaction(() => {
    const puestos = [];
    const usados = new Set();
    casillas.forEach((c, i) => {
      let idx = analizados.findIndex((x, j) =>
        !usados.has(j) && String(x?.pedido || '').trim().toLowerCase() === c.nombre.toLowerCase());
      if (idx === -1 && !usados.has(i) && analizados[i]) idx = i;
      if (idx === -1) return;
      usados.add(idx);

      const p = analizados[idx];
      // La IA no reconocio el texto: no se inventa un plato, se le dice al usuario.
      if (p?.reconocido === false) {
        puestos.push({ dia: c.dia, momento: c.momento, pedido: c.nombre, reconocido: false });
        return;
      }
      // El nombre que se guarda es el normalizado por la IA ("aji d gallina" -> "Ají de
      // gallina"), con el del usuario como respaldo.
      const platoId = crearPlato(
        usuario.id,
        { ...p, nombre: p?.nombre || c.nombre },
        c.momento, ctx.hogar.comensales, ctx.hogar.region, 'propuesto'
      );
      if (!platoId) return;
      ponerEnCasilla(usuario.id, semana, c.dia, c.momento, platoId, ctx.hogar.comensales);
      db.prepare(
        `UPDATE plan_comidas SET cobertura = ?, verificado_en = datetime('now')
          WHERE usuario_id = ? AND semana = ? AND dia = ? AND momento = ?`
      ).run(normCobertura(p), usuario.id, semana, c.dia, c.momento);
      puestos.push({ dia: c.dia, momento: c.momento, pedido: c.nombre, reconocido: true });
    });
    return puestos;
  });
  const puestos = tx();

  const ok = puestos.filter((p) => p.reconocido);
  if (!ok.length) {
    const nombres = puestos.map((p) => `"${p.pedido}"`).join(', ');
    return res.status(422).json({
      error: `No reconocimos ${nombres} como un plato. Escribelo de otra forma (ej. "aji de gallina").`,
      no_reconocidos: puestos.map((p) => p.pedido),
    });
  }

  res.status(201).json({
    mensaje: ok.length === 1 ? 'Plato verificado y puesto en tu calendario.' : `${ok.length} platos verificados.`,
    verificados: ok.length,
    no_reconocidos: puestos.filter((p) => !p.reconocido).map((p) => p.pedido),
    semana,
    plan: planSemana(usuario.id, semana),
    limites: { generaciones_max: usuario.generaciones_max, generaciones_usadas: generacionesUsadas(usuario.id, semana) },
  });
});

// ===== Edicion manual del calendario =====

// POST /api/plan { semana, dia, momento, plato_id } -> pone un plato de la biblioteca en una casilla
router.post('/', (req, res) => {
  const semana = lunesDe(req.body?.semana);
  const dia = parseInt(req.body?.dia, 10);
  const momento = String(req.body?.momento || '');
  const platoId = parseInt(req.body?.plato_id, 10);

  if (!(dia >= 0 && dia <= 6)) return res.status(400).json({ error: 'Dia invalido.' });
  if (!MOMENTOS.includes(momento)) return res.status(400).json({ error: 'Momento invalido.' });
  const plato = db.prepare('SELECT id FROM platos WHERE id = ? AND usuario_id = ?').get(platoId, req.usuario.id);
  if (!plato) return res.status(404).json({ error: 'Plato no encontrado.' });

  if (semanaBloqueada(req.usuario.id, semana, req.usuario.semanas_max)) {
    return res.status(403).json({
      error: `Tu plan permite programar ${req.usuario.semanas_max} semana(s). Pasa a un plan superior para programar mas.`,
      upgrade: true, redirect: '/mi-plan.html',
    });
  }

  const comensales = db.prepare('SELECT comensales FROM hogar WHERE usuario_id = ?').get(req.usuario.id)?.comensales || 1;
  db.transaction(() => ponerEnCasilla(req.usuario.id, semana, dia, momento, plato.id, comensales))();
  res.status(201).json({ semana, plan: planSemana(req.usuario.id, semana) });
});

// PATCH /api/plan/:id { cocinado } -> marcar una comida como cocinada
//
// AQUI es donde el consumo deja de ser proyeccion y se descuenta de verdad de la despensa.
// Marcar resta ; desmarcar devuelve EXACTAMENTE lo que se resto (consumo_aplicado), no lo
// que se volveria a estimar hoy: entre una cosa y la otra el usuario pudo editar la barra
// a mano o comprar de nuevo, y recalcular le devolveria un porcentaje que nunca se le quito.
router.patch('/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM plan_comidas WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Comida no encontrada en tu plan.' });
  const quiere = req.body?.cocinado ? 1 : 0;

  db.transaction(() => {
    // Solo se mueve la despensa cuando el estado CAMBIA: dos "marcar cocinado" seguidos no
    // pueden descontar dos veces el mismo plato.
    if (quiere && !it.cocinado) aplicarConsumo(req.usuario.id, it);
    else if (!quiere && it.cocinado) revertirConsumo(req.usuario.id, it);
    db.prepare('UPDATE plan_comidas SET cocinado = ? WHERE id = ?').run(quiere, it.id);
  })();

  res.json({ semana: it.semana, plan: planSemana(req.usuario.id, it.semana) });
});

// Descuenta de la despensa lo que se lleva esta casilla y deja registro de lo aplicado.
// Se guarda lo REALMENTE descontado (el descuento se topa en 0), que es lo que hace que
// revertir sea exacto aunque al producto le quedara menos de lo que el plato pedia.
function aplicarConsumo(usuarioId, casilla) {
  const consumo = consumoDeCasillaId(usuarioId, casilla.id);
  const leer = db.prepare('SELECT porcentaje FROM despensa WHERE id = ? AND usuario_id = ?');
  const escribir = db.prepare("UPDATE despensa SET porcentaje = ?, nivel = ?, actualizado_en = datetime('now') WHERE id = ?");

  const aplicado = {};
  for (const [despensaId, pct] of consumo) {
    const fila = leer.get(despensaId, usuarioId);
    if (!fila) continue;
    const real = Math.min(fila.porcentaje, Math.round(pct));
    if (real <= 0) continue;
    const nuevo = clampPct(fila.porcentaje - real);
    escribir.run(nuevo, nivelDePorcentaje(nuevo), despensaId);
    aplicado[despensaId] = real;
  }
  db.prepare('UPDATE plan_comidas SET consumo_aplicado = ? WHERE id = ?')
    .run(Object.keys(aplicado).length ? JSON.stringify(aplicado) : null, casilla.id);
}

// Devuelve a la despensa lo que esta casilla le habia descontado.
function revertirConsumo(usuarioId, casilla) {
  let aplicado = {};
  try { aplicado = JSON.parse(casilla.consumo_aplicado || '{}'); }
  catch { aplicado = {}; } // registro corrupto: no se devuelve nada, pero no se tumba el desmarcado

  const leer = db.prepare('SELECT porcentaje FROM despensa WHERE id = ? AND usuario_id = ?');
  const escribir = db.prepare("UPDATE despensa SET porcentaje = ?, nivel = ?, actualizado_en = datetime('now') WHERE id = ?");
  for (const [despensaId, pct] of Object.entries(aplicado)) {
    const fila = leer.get(Number(despensaId), usuarioId);
    if (!fila) continue; // el producto ya no esta en la despensa: no hay donde devolverlo
    const nuevo = clampPct(fila.porcentaje + Number(pct || 0));
    escribir.run(nuevo, nivelDePorcentaje(nuevo), Number(despensaId));
  }
  db.prepare('UPDATE plan_comidas SET consumo_aplicado = NULL WHERE id = ?').run(casilla.id);
}

// DELETE /api/plan/:id -> vaciar una casilla
router.delete('/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM plan_comidas WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Comida no encontrada en tu plan.' });
  db.transaction(() => {
    // Vaciar una casilla ya cocinada le devuelve a la despensa lo que se le habia
    // descontado: si no, el stock quedaria bajo por un plato que ya no existe.
    if (it.cocinado) revertirConsumo(req.usuario.id, it);
    db.prepare('DELETE FROM plan_comidas WHERE id = ?').run(it.id);
    limpiarPlatoHuerfano(req.usuario.id, it.plato_id);
  })();
  res.json({ mensaje: 'Casilla vaciada.', semana: it.semana, plan: planSemana(req.usuario.id, it.semana) });
});

// POST /api/plan/copiar { desde, hacia } -> duplica la programacion de una semana en otra
router.post('/copiar', (req, res) => {
  const desde = lunesDe(req.body?.desde);
  const hacia = lunesDe(req.body?.hacia);
  if (desde === hacia) return res.status(400).json({ error: 'Las semanas de origen y destino son la misma.' });

  if (semanaBloqueada(req.usuario.id, hacia, req.usuario.semanas_max)) {
    return res.status(403).json({
      error: `Tu plan permite programar ${req.usuario.semanas_max} semana(s). Pasa a un plan superior para programar mas.`,
      upgrade: true, redirect: '/mi-plan.html',
    });
  }

  const origen = db.prepare('SELECT dia, momento, plato_id, comensales FROM plan_comidas WHERE usuario_id = ? AND semana = ?')
    .all(req.usuario.id, desde);
  if (!origen.length) return res.status(404).json({ error: 'La semana de origen no tiene programacion.' });

  // Se apunta a los MISMOS platos (no se duplican): un plato es una receta, y la misma
  // receta puede estar en dos semanas.
  const copiados = db.transaction(() => {
    let n = 0;
    for (const it of origen) {
      ponerEnCasilla(req.usuario.id, hacia, it.dia, it.momento, it.plato_id, it.comensales);
      n++;
    }
    return n;
  })();

  res.json({ copiados, semana: hacia, plan: planSemana(req.usuario.id, hacia) });
});

module.exports = router;
