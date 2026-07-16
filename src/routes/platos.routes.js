// Rutas de MIS PLATOS: la biblioteca del usuario.
//
// La biblioteca es lo que el usuario decide CURAR (platos.guardado = 1), no todo lo que
// la IA produce. Generar una semana crea 21 platos y el plan Free permite 5, asi que el
// tope platos_max cuenta SOLO los guardados. Ver la nota en db.js sobre `guardado`.
//
// No usa IA ni consume analisis: el gate es el plan. Crear un plato aqui es manual.
const express = require('express');
const { db, MOMENTOS } = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador } = require('../middleware/planificador');

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
