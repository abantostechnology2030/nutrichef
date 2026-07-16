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
const { db, lunesDe, fechaPeru, MOMENTOS, DIAS } = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador, requiereHogar } = require('../middleware/planificador');
const { contextoDe, textoContexto } = require('../services/contexto');
const { generarPlatos, detallarPlatos, verificarPlatos } = require('../services/ai.service');

const router = express.Router();
router.use(requiereAuth, requierePlanificador);

// Orden de los dias en el calendario: lunes..domingo. La BD usa 0=Domingo (como
// Date.getDay()), asi que el indice del array de la IA se mapea con esto.
const DIA_NUM = [1, 2, 3, 4, 5, 6, 0];
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
    JSON.stringify(lista(p?.ingredientes)),
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
  const previo = db.prepare('SELECT plato_id FROM plan_comidas WHERE usuario_id = ? AND semana = ? AND dia = ? AND momento = ?')
    .get(usuarioId, semana, dia, momento);
  if (previo) db.prepare('DELETE FROM plan_comidas WHERE usuario_id = ? AND semana = ? AND dia = ? AND momento = ?').run(usuarioId, semana, dia, momento);

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

// POST /api/plan/detallar { semana } -> completa la RECETA (platos.pasos) y/o el aporte
// nutricional (platos.info) de los platos de esa semana a los que les falte.
//
// Es SOLO backfill: los platos que genera el planificador ya nacen con receta y nutricion
// y no pasan por aqui. Existe para los generados antes de que se pidieran esos campos (la
// nutricion se sumo primero y la receta despues, asi que hay platos con una y sin la otra).
// Si no falta ninguno, responde sin llamar a la IA (y sin consumir cupo): no se cobra por
// no hacer nada.
router.post('/detallar', requiereHogar, async (req, res) => {
  const semana = lunesDe(req.body?.semana);
  const usuario = req.usuario;

  // Solo los de ESTA semana a los que les falte la receta o la nutricion. Un plato es
  // estable: una vez calculados, ni su receta ni su aporte cambian, asi que esto es cache
  // gratis para siempre.
  const pendientes = db.prepare(
    `SELECT DISTINCT p.id, p.nombre, p.porciones, p.ingredientes, p.pasos, p.info
       FROM plan_comidas pc
       JOIN platos p ON p.id = pc.plato_id
      WHERE pc.usuario_id = ? AND pc.semana = ? AND (p.info IS NULL OR p.pasos IS NULL)`
  ).all(usuario.id, semana);

  if (!pendientes.length) {
    return res.json({ mensaje: 'Todos los platos de esta semana ya tienen su receta y su informacion nutricional.', detallados: 0, semana });
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
  const paraIA = pendientes.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    porciones: p.porciones,
    ingredientes: JSON.parse(p.ingredientes || '[]'),
    necesita: [!p.info ? 'info' : null, !p.pasos ? 'pasos' : null].filter(Boolean),
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
router.patch('/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM plan_comidas WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Comida no encontrada en tu plan.' });
  db.prepare('UPDATE plan_comidas SET cocinado = ? WHERE id = ?').run(req.body?.cocinado ? 1 : 0, it.id);
  res.json({ semana: it.semana, plan: planSemana(req.usuario.id, it.semana) });
});

// DELETE /api/plan/:id -> vaciar una casilla
router.delete('/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM plan_comidas WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Comida no encontrada en tu plan.' });
  db.transaction(() => {
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
