// Rutas de MIS PLATOS: la biblioteca del usuario.
//
// La biblioteca es lo que el usuario decide CURAR (platos.guardado = 1), no todo lo que
// la IA produce. Generar una semana crea 21 platos y el plan Free permite 5, asi que el
// tope platos_max cuenta SOLO los guardados. Ver la nota en db.js sobre `guardado`.
//
// No usa IA ni consume analisis: el gate es el plan. Crear un plato aqui es manual.
const express = require('express');
const { db, MOMENTOS, lunesDe, fechaPeru } = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador } = require('../middleware/planificador');
const { contextoDe, textoContexto } = require('../services/contexto');
const { verificarPlatos, proponerPlatosBiblioteca } = require('../services/ai.service');
// crearPlato y los helpers de cupo viven en plan.routes.js y se reutilizan desde ahi: son el
// MISMO plato y el MISMO cupo, y duplicarlos aqui los desincronizaria a la primera.
const plan = require('./plan.routes');

const router = express.Router();
router.use(requiereAuth, requierePlanificador);

const DIFICULTADES = ['facil', 'media', 'dificil'];

const normMomento = (v) => (MOMENTOS.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null);
const normDificultad = (v) => (DIFICULTADES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : null);

// Cuantos platos tiene el usuario en su biblioteca (lo que cuenta contra platos_max).
const guardadosDe = (usuarioId) =>
  db.prepare('SELECT COUNT(*) c FROM platos WHERE usuario_id = ? AND guardado = 1').get(usuarioId).c;

// Verifica el tope ANTES de guardar. Devuelve el error listo para responder, o null.
// `platos_max` NULL = ilimitado (y el admin siempre lo tiene en NULL).
function topeAlcanzado(usuario) {
  const max = usuario.platos_max;
  if (max == null) return null;
  if (guardadosDe(usuario.id) < max) return null;
  return {
    error: `Tu plan permite guardar ${max} plato(s) en tu biblioteca. Pasa a un plan superior para guardar mas.`,
    upgrade: true,
    redirect: '/mi-plan.html',
  };
}

// Normaliza la lista de ingredientes que manda el formulario. Mismo formato que usa la
// IA al generar: [{nombre, cantidad, unidad}]. Se descartan las filas sin nombre.
function normIngredientes(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((i) => ({
      nombre: String(i?.nombre || '').trim().slice(0, 80),
      cantidad: String(i?.cantidad ?? '').trim().slice(0, 20),
      unidad: String(i?.unidad || '').trim().slice(0, 20),
    }))
    .filter((i) => i.nombre)
    .slice(0, 40);
}

// Los pasos son texto libre, uno por linea en el formulario.
function normPasos(v) {
  if (!Array.isArray(v)) return null;
  const limpios = v.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 30);
  return limpios.length ? limpios : null;
}

function platoPublico(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    momento: p.momento,
    porciones: p.porciones,
    ingredientes: JSON.parse(p.ingredientes || '[]'),
    faltantes: JSON.parse(p.faltantes || '[]'),
    pasos: p.pasos ? JSON.parse(p.pasos) : null,
    info: p.info ? JSON.parse(p.info) : null,
    nota: p.nota,
    tiempo_min: p.tiempo_min,
    dificultad: p.dificultad,
    region: p.region,
    origen: p.origen,
    guardado: !!p.guardado,
    creado_en: p.creado_en,
    // En cuantas casillas del calendario esta puesto. Importa al borrar: la FK de
    // plan_comidas es ON DELETE CASCADE, asi que borrar el plato lo saca del plan.
    en_plan: p.en_plan ?? 0,
  };
}

const SELECT_BASE = `
  SELECT p.*, (SELECT COUNT(*) FROM plan_comidas pc WHERE pc.plato_id = p.id) AS en_plan
    FROM platos p
   WHERE p.usuario_id = ?`;

// GET /api/platos -> la biblioteca (solo guardados) + el estado del tope
router.get('/', (req, res) => {
  const { momento, q } = req.query;
  const args = [req.usuario.id];
  let sql = `${SELECT_BASE} AND p.guardado = 1`;

  const m = normMomento(momento);
  if (m) {
    sql += ' AND p.momento = ?';
    args.push(m);
  }
  if (q) {
    sql += ' AND LOWER(p.nombre) LIKE ?';
    args.push(`%${String(q).toLowerCase().trim()}%`);
  }
  sql += ' ORDER BY p.creado_en DESC';

  const max = req.usuario.platos_max;
  const usados = guardadosDe(req.usuario.id);
  res.json({
    platos: db.prepare(sql).all(...args).map(platoPublico),
    limite: { max, usados, ilimitado: max == null, restantes: max == null ? null : Math.max(0, max - usados) },
    momentos: MOMENTOS,
    dificultades: DIFICULTADES,
  });
});

// GET /api/platos/:id -> detalle de un plato (guardado o no: sirve para el modal del plan)
// Guarda en la BIBLIOTECA un plato que devolvio la IA. Reutiliza crearPlato() del
// planificador (misma normalizacion de ingredientes, pasos, info y consume) y solo cambia dos
// cosas: nace con guardado=1 y con origen 'ia'.
function crearPlatoBiblioteca(usuarioId, p, momento) {
  const hogar = db.prepare('SELECT comensales, region FROM hogar WHERE usuario_id = ?').get(usuarioId) || {};
  const mom = MOMENTOS.includes(String(p?.momento || '')) ? p.momento : momento;
  const id = plan.crearPlato(usuarioId, p, mom, hogar.comensales || null, hogar.region || null, 'ia', 1);
  return db.prepare('SELECT * FROM platos WHERE id = ?').get(id);
}

// POST /api/platos/generar
//   { nombres: ["Aji de gallina", ...] }  -> genera ESOS platos (los escribio el usuario)
//   { cuantos: 1, momento? }              -> la IA PROPONE uno que el usuario NO tenga
//
// Los platos nacen con guardado=1: el sentido de esta ruta es llenar la BIBLIOTECA para
// reutilizarlos despues, no ocupar una casilla del calendario.
//
// Cuesta una generacion de cupo, igual que generar un dia: es una llamada a la IA. Se cobra
// contra la SEMANA ACTUAL porque un plato de biblioteca no pertenece a ninguna semana.
router.post('/generar', async (req, res) => {
  const usuario = req.usuario;
  const nombres = (Array.isArray(req.body?.nombres) ? req.body.nombres : [])
    .map((n) => String(n || '').trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 3);
  const cuantos = Math.max(1, Math.min(3, parseInt(req.body?.cuantos, 10) || 1));
  const momento = MOMENTOS.includes(String(req.body?.momento || '')) ? req.body.momento : null;

  // El tope de la biblioteca se comprueba ANTES de llamar a la IA: generar y luego rechazar
  // seria cobrarle una generacion por nada.
  const lim = limiteDe(usuario);
  const pediria = nombres.length || cuantos;
  if (lim.max !== null && lim.usados + pediria > lim.max) {
    return res.status(403).json({
      error: `Tu plan permite ${lim.max} plato(s) guardados y ya tienes ${lim.usados}. Borra alguno o pasa a un plan superior.`,
      upgrade: true, redirect: '/mi-plan.html',
    });
  }

  const ctx = contextoDe(usuario.id);
  if (!ctx || !ctx.integrantes.length) {
    return res.status(409).json({ error: 'Configura tu hogar antes de generar platos.', necesita_hogar: true, redirect: '/hogar.html' });
  }
  const semana = lunesDe(fechaPeru());
  const sinCupo = plan.cupoAgotado(usuario, semana);
  if (sinCupo) return res.status(403).json(sinCupo);

  const ctxTexto = textoContexto(ctx);
  const yaTiene = db.prepare('SELECT nombre FROM platos WHERE usuario_id = ? AND guardado = 1 ORDER BY id DESC LIMIT 40')
    .all(usuario.id).map((p) => p.nombre);

  let resultado; let usage;
  try {
    ({ resultado, usage } = nombres.length
      // Escribir el nombre y generarlo es el mismo problema que "ya se que voy a cocinar" del
      // plan: el usuario dice QUE quiere y la IA lo desarrolla. Se reutiliza ese flujo en vez
      // de escribir otro prompt que daria recetas con distinto formato para el mismo plato.
      ? await verificarPlatos(ctxTexto, nombres.map((n) => ({ nombre: n, momento: momento || 'almuerzo' })))
      : await proponerPlatosBiblioteca(ctxTexto, cuantos, yaTiene, momento));
  } catch (e) {
    plan.registrarGeneracion(usuario.id, semana, 'plato', {});
    return res.status(502).json({ error: 'La IA no pudo generar el plato ahora. Intentalo de nuevo.' });
  }
  plan.registrarGeneracion(usuario.id, semana, 'plato', usage);

  const lista = Array.isArray(resultado?.platos) ? resultado.platos : [];
  // Si el usuario escribio algo que no es un plato, la IA lo marca y se le dice, en vez de
  // guardarle una receta inventada a partir de un texto sin sentido.
  const noReconocidos = lista.filter((p) => p && p.reconocido === false).map((p) => p.nombre_pedido || p.nombre);
  const buenos = lista.filter((p) => p && p.reconocido !== false && String(p.nombre || '').trim());
  if (!buenos.length) {
    return res.status(422).json({
      error: noReconocidos.length
        ? `No reconocimos "${noReconocidos.join('", "')}" como un plato. Escribelo de otra forma.`
        : 'La IA no devolvio ningun plato. Intentalo de nuevo.',
      no_reconocidos: noReconocidos,
    });
  }

  const creados = buenos.map((p) => crearPlatoBiblioteca(usuario.id, p, momento));
  res.status(201).json({
    platos: creados,
    no_reconocidos: noReconocidos,
    limite: limiteDe(usuario),
    mensaje: creados.length === 1
      ? `Se agregó "${creados[0].nombre}" a tus platos.`
      : `Se agregaron ${creados.length} platos a tu biblioteca.`,
  });
});

router.get('/:id', (req, res) => {
  const p = db.prepare(`${SELECT_BASE} AND p.id = ?`).get(req.usuario.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Plato no encontrado' });
  res.json({ plato: platoPublico(p) });
});

// POST /api/platos -> crea un plato manual. Nace en la biblioteca, asi que aplica el tope.
router.post('/', (req, res) => {
  const nombre = String(req.body?.nombre || '').trim().slice(0, 120);
  if (!nombre) return res.status(400).json({ error: 'El nombre del plato es obligatorio' });

  const tope = topeAlcanzado(req.usuario);
  if (tope) return res.status(403).json(tope);

  const porciones = Math.max(1, parseInt(req.body?.porciones, 10) || 1);
  const tiempo = req.body?.tiempo_min ? Math.max(1, parseInt(req.body.tiempo_min, 10)) : null;
  const pasos = normPasos(req.body?.pasos);

  const info = db.prepare(
    `INSERT INTO platos (usuario_id, nombre, momento, porciones, ingredientes, pasos, nota, tiempo_min, dificultad, origen, guardado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1)`
  ).run(
    req.usuario.id,
    nombre,
    normMomento(req.body?.momento),
    porciones,
    JSON.stringify(normIngredientes(req.body?.ingredientes)),
    pasos ? JSON.stringify(pasos) : null,
    String(req.body?.nota || '').trim().slice(0, 400) || null,
    tiempo,
    normDificultad(req.body?.dificultad)
  );

  const p = db.prepare(`${SELECT_BASE} AND p.id = ?`).get(req.usuario.id, info.lastInsertRowid);
  res.status(201).json({ plato: platoPublico(p) });
});

// PUT /api/platos/:id -> edita un plato de la biblioteca
router.put('/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM platos WHERE id = ? AND usuario_id = ?').get(req.params.id, req.usuario.id);
  if (!actual) return res.status(404).json({ error: 'Plato no encontrado' });

  const nombre = String(req.body?.nombre || '').trim().slice(0, 120);
  if (!nombre) return res.status(400).json({ error: 'El nombre del plato es obligatorio' });

  const pasos = normPasos(req.body?.pasos);
  db.prepare(
    `UPDATE platos SET nombre = ?, momento = ?, porciones = ?, ingredientes = ?, pasos = ?, nota = ?, tiempo_min = ?, dificultad = ?
      WHERE id = ? AND usuario_id = ?`
  ).run(
    nombre,
    normMomento(req.body?.momento),
    Math.max(1, parseInt(req.body?.porciones, 10) || actual.porciones),
    JSON.stringify(normIngredientes(req.body?.ingredientes)),
    pasos ? JSON.stringify(pasos) : null,
    String(req.body?.nota || '').trim().slice(0, 400) || null,
    req.body?.tiempo_min ? Math.max(1, parseInt(req.body.tiempo_min, 10)) : null,
    normDificultad(req.body?.dificultad),
    req.params.id,
    req.usuario.id
  );

  const p = db.prepare(`${SELECT_BASE} AND p.id = ?`).get(req.usuario.id, req.params.id);
  res.json({ plato: platoPublico(p) });
});

// POST /api/platos/:id/guardar -> mete en la biblioteca un plato que genero la IA.
// Aqui SI aplica platos_max: es el momento en que el usuario decide curarlo.
router.post('/:id/guardar', (req, res) => {
  const p = db.prepare('SELECT * FROM platos WHERE id = ? AND usuario_id = ?').get(req.params.id, req.usuario.id);
  if (!p) return res.status(404).json({ error: 'Plato no encontrado' });
  if (p.guardado) return res.json({ plato: platoPublico({ ...p, en_plan: 0 }), ya: true });

  const tope = topeAlcanzado(req.usuario);
  if (tope) return res.status(403).json(tope);

  db.prepare('UPDATE platos SET guardado = 1 WHERE id = ?').run(p.id);
  const out = db.prepare(`${SELECT_BASE} AND p.id = ?`).get(req.usuario.id, p.id);
  res.json({ plato: platoPublico(out) });
});

// DELETE /api/platos/:id/guardar -> lo saca de la biblioteca sin borrarlo del plan.
// Si ademas no esta en ninguna casilla y lo genero la IA, queda huerfano: se borra
// (misma regla que limpiarPlatoHuerfano en plan.routes.js, para no acumular basura).
router.delete('/:id/guardar', (req, res) => {
  const p = db.prepare('SELECT * FROM platos WHERE id = ? AND usuario_id = ?').get(req.params.id, req.usuario.id);
  if (!p) return res.status(404).json({ error: 'Plato no encontrado' });

  db.prepare('UPDATE platos SET guardado = 0 WHERE id = ?').run(p.id);

  const enUso = db.prepare('SELECT 1 FROM plan_comidas WHERE plato_id = ? LIMIT 1').get(p.id);
  if (!enUso && p.origen !== 'manual') {
    db.prepare('DELETE FROM platos WHERE id = ?').run(p.id);
    return res.json({ ok: true, borrado: true });
  }
  res.json({ ok: true, borrado: false });
});

// DELETE /api/platos/:id -> borra el plato.
// OJO: plan_comidas.plato_id es ON DELETE CASCADE, asi que esto tambien lo quita de las
// casillas del calendario donde estuviera. El front avisa antes (ver en_plan).
router.delete('/:id', (req, res) => {
  const p = db.prepare('SELECT id FROM platos WHERE id = ? AND usuario_id = ?').get(req.params.id, req.usuario.id);
  if (!p) return res.status(404).json({ error: 'Plato no encontrado' });

  const enPlan = db.prepare('SELECT COUNT(*) c FROM plan_comidas WHERE plato_id = ?').get(p.id).c;
  db.prepare('DELETE FROM platos WHERE id = ?').run(p.id);
  res.json({ ok: true, quitado_del_plan: enPlan });
});

module.exports = router;
