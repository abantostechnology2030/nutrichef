// Rutas del HOGAR: la configuracion previa sin la cual la IA no puede proponer nada.
// Cubre los datos de la familia (region, dieta, presupuesto) y sus integrantes con
// sus condiciones medicas y alergias.
//
// No usa IA ni consume analisis: el gate es el plan.
const express = require('express');
const {
  db, usuarioPublico, REGIONES, DIETAS, PRESUPUESTOS, CONDICIONES_COMUNES, ALERGIAS_COMUNES,
} = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador } = require('../middleware/planificador');

const router = express.Router();
// Ojo: NO se exige requiereHogar aqui — este es justamente el modulo que lo configura.
router.use(requiereAuth, requierePlanificador);

const enLista = (v, lista, def) => (lista.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : def);

// Normaliza una lista de condiciones/alergias: texto libre, sin vacios ni duplicados.
// Se acepta cualquier texto (no solo las sugerencias): una familia real puede tener
// una condicion que no esta en nuestra lista.
function normLista(v) {
  if (!Array.isArray(v)) return [];
  const vistos = new Set();
  const out = [];
  for (const x of v) {
    const s = String(x || '').trim().slice(0, 60);
    const k = s.toLowerCase();
    if (!s || vistos.has(k)) continue;
    vistos.add(k);
    out.push(s);
    if (out.length >= 15) break;
  }
  return out;
}

const hogarDe = (usuarioId) => db.prepare('SELECT * FROM hogar WHERE usuario_id = ?').get(usuarioId);

// Crea el hogar del usuario si aun no existe (con los defaults del esquema).
function asegurarHogar(usuarioId) {
  const h = hogarDe(usuarioId);
  if (h) return h;
  db.prepare('INSERT INTO hogar (usuario_id) VALUES (?)').run(usuarioId);
  return hogarDe(usuarioId);
}

const integrantesDe = (hogarId) =>
  db.prepare('SELECT * FROM integrantes WHERE hogar_id = ? ORDER BY id').all(hogarId).map((i) => ({
    ...i,
    condiciones: JSON.parse(i.condiciones || '[]'),
    alergias: JSON.parse(i.alergias || '[]'),
  }));

// Mantiene los dos invariantes del hogar:
//   comensales  = numero de integrantes (una sola fuente de verdad; no es un campo aparte
//                 que el usuario pueda dejar desincronizado con la lista real).
//   configurado = hay al menos 1 integrante (antes de eso la IA no tiene con que trabajar).
function recalcularHogar(hogarId) {
  const n = db.prepare('SELECT COUNT(*) c FROM integrantes WHERE hogar_id = ?').get(hogarId).c;
  db.prepare('UPDATE hogar SET comensales = ?, configurado = ? WHERE id = ?').run(Math.max(1, n), n > 0 ? 1 : 0, hogarId);
}

// Respuesta estandar del modulo: hogar + integrantes + catalogos para el formulario.
function estado(usuarioId) {
  const h = asegurarHogar(usuarioId);
  return {
    hogar: h,
    integrantes: integrantesDe(h.id),
    opciones: {
      regiones: REGIONES,
      dietas: DIETAS,
      presupuestos: PRESUPUESTOS,
      condiciones_comunes: CONDICIONES_COMUNES,
      alergias_comunes: ALERGIAS_COMUNES,
    },
  };
}

// GET /api/hogar -> configuracion actual + integrantes + opciones del formulario
router.get('/', (req, res) => res.json(estado(req.usuario.id)));

// PUT /api/hogar { nombre, region, ciudad, dieta, presupuesto, notas }
// "comensales" y "configurado" NO se aceptan del cliente: son derivados (ver recalcularHogar).
router.put('/', (req, res) => {
  const h = asegurarHogar(req.usuario.id);
  const b = req.body || {};
  db.prepare(
    'UPDATE hogar SET nombre = ?, region = ?, ciudad = ?, dieta = ?, presupuesto = ?, notas = ? WHERE id = ?'
  ).run(
    b.nombre !== undefined ? String(b.nombre).trim().slice(0, 60) || null : h.nombre,
    b.region !== undefined ? enLista(b.region, REGIONES, h.region) : h.region,
    b.ciudad !== undefined ? String(b.ciudad).trim().slice(0, 60) || null : h.ciudad,
    b.dieta !== undefined ? enLista(b.dieta, DIETAS, h.dieta) : h.dieta,
    b.presupuesto !== undefined ? enLista(b.presupuesto, PRESUPUESTOS, h.presupuesto) : h.presupuesto,
    b.notas !== undefined ? String(b.notas).trim().slice(0, 400) || null : h.notas,
    h.id
  );
  recalcularHogar(h.id);
  res.json({ ...estado(req.usuario.id), usuario: usuarioPublico(req.usuario.id) });
});

// POST /api/hogar/integrantes { nombre, edad, condiciones[], alergias[], notas }
router.post('/integrantes', (req, res) => {
  const h = asegurarHogar(req.usuario.id);
  const b = req.body || {};
  const nombre = String(b.nombre || '').trim().slice(0, 60);
  if (!nombre) return res.status(400).json({ error: 'El nombre del integrante es obligatorio.' });

  const edad = b.edad === '' || b.edad == null ? null : Math.min(120, Math.max(0, parseInt(b.edad, 10) || 0));
  const info = db.prepare(
    'INSERT INTO integrantes (hogar_id, nombre, edad, condiciones, alergias, notas) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(h.id, nombre, edad, JSON.stringify(normLista(b.condiciones)), JSON.stringify(normLista(b.alergias)),
        String(b.notas || '').trim().slice(0, 200) || null);

  recalcularHogar(h.id);
  res.status(201).json({
    integrante: integrantesDe(h.id).find((i) => i.id === info.lastInsertRowid),
    ...estado(req.usuario.id),
    usuario: usuarioPublico(req.usuario.id),
  });
});

// PATCH /api/hogar/integrantes/:id
router.patch('/integrantes/:id', (req, res) => {
  const h = asegurarHogar(req.usuario.id);
  const it = db.prepare('SELECT * FROM integrantes WHERE id = ? AND hogar_id = ?').get(Number(req.params.id), h.id);
  if (!it) return res.status(404).json({ error: 'Integrante no encontrado.' });

  const b = req.body || {};
  db.prepare('UPDATE integrantes SET nombre = ?, edad = ?, condiciones = ?, alergias = ?, notas = ? WHERE id = ?').run(
    b.nombre !== undefined ? String(b.nombre).trim().slice(0, 60) || it.nombre : it.nombre,
    b.edad !== undefined ? (b.edad === '' || b.edad === null ? null : Math.min(120, Math.max(0, parseInt(b.edad, 10) || 0))) : it.edad,
    b.condiciones !== undefined ? JSON.stringify(normLista(b.condiciones)) : it.condiciones,
    b.alergias !== undefined ? JSON.stringify(normLista(b.alergias)) : it.alergias,
    b.notas !== undefined ? String(b.notas || '').trim().slice(0, 200) || null : it.notas,
    it.id
  );
  res.json({ ...estado(req.usuario.id), usuario: usuarioPublico(req.usuario.id) });
});

// DELETE /api/hogar/integrantes/:id
router.delete('/integrantes/:id', (req, res) => {
  const h = asegurarHogar(req.usuario.id);
  const it = db.prepare('SELECT id FROM integrantes WHERE id = ? AND hogar_id = ?').get(Number(req.params.id), h.id);
  if (!it) return res.status(404).json({ error: 'Integrante no encontrado.' });
  db.prepare('DELETE FROM integrantes WHERE id = ?').run(it.id);
  recalcularHogar(h.id); // si era el ultimo, el hogar vuelve a "sin configurar"
  res.json({ ...estado(req.usuario.id), usuario: usuarioPublico(req.usuario.id) });
});

module.exports = router;
