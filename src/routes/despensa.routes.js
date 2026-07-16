// Rutas de la DESPENSA: el inventario de lo que el usuario tiene en casa, y la
// COMPRA SEMANAL que lo abastece. Es la entrada del planificador: la IA propone
// platos a partir de esto.
//
// Inventario SIMPLE a proposito: nivel poco|normal|bastante, sin descuento automatico
// al cocinar. Descontar gramos exigiria conversion de unidades y mermas, y la IA razona
// bien con disponibilidad. Ver CLAUDE.md.
//
// No usa IA ni consume analisis: el gate es el plan.
const express = require('express');
const { db, lunesDe, CATEGORIAS_ING, NIVELES } = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador } = require('../middleware/planificador');

const router = express.Router();
router.use(requiereAuth, requierePlanificador);

const normCat = (v) => (CATEGORIAS_ING.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'otro');
const normNivel = (v) => (NIVELES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'normal');

// Categoria por defecto de un ingrediente: la del catalogo del admin si existe.
// Asi el usuario no tiene que clasificar "Rocoto" a mano si ya esta en el catalogo.
function categoriaSugerida(nombre, fallback) {
  if (fallback) return normCat(fallback);
  const hit = db.prepare('SELECT categoria FROM ingredientes_catalogo WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1').get(nombre);
  return hit ? hit.categoria : 'otro';
}

const despensaDe = (usuarioId) =>
  db.prepare('SELECT * FROM despensa WHERE usuario_id = ? ORDER BY categoria, nombre').all(usuarioId);

// Agrega o actualiza un ingrediente de la despensa. Hay un UNIQUE por (usuario, nombre
// normalizado), asi que un mismo ingrediente NUNCA se duplica: se le actualiza el nivel.
// Se resuelve a mano (en vez de ON CONFLICT) porque el indice es sobre una expresion.
function guardarIngrediente(usuarioId, { nombre, categoria, nivel, origen = 'manual', compraId = null }) {
  const limpio = String(nombre || '').trim().slice(0, 80);
  if (!limpio) return null;

  const existe = db.prepare('SELECT * FROM despensa WHERE usuario_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))').get(usuarioId, limpio);
  if (existe) {
    db.prepare("UPDATE despensa SET nivel = ?, categoria = ?, origen = ?, compra_id = ?, actualizado_en = datetime('now') WHERE id = ?")
      .run(normNivel(nivel || existe.nivel), categoria ? normCat(categoria) : existe.categoria, origen, compraId, existe.id);
    return db.prepare('SELECT * FROM despensa WHERE id = ?').get(existe.id);
  }
  const info = db.prepare('INSERT INTO despensa (usuario_id, nombre, categoria, nivel, origen, compra_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(usuarioId, limpio, categoriaSugerida(limpio, categoria), normNivel(nivel), origen, compraId);
  return db.prepare('SELECT * FROM despensa WHERE id = ?').get(info.lastInsertRowid);
}

// GET /api/despensa -> inventario + catalogo activo (para elegir rapido) + opciones
router.get('/', (req, res) => {
  res.json({
    despensa: despensaDe(req.usuario.id),
    catalogo: db.prepare('SELECT id, nombre, categoria FROM ingredientes_catalogo WHERE activo = 1 ORDER BY categoria, nombre').all(),
    categorias: CATEGORIAS_ING,
    niveles: NIVELES,
  });
});

// POST /api/despensa { nombre, categoria?, nivel? } -> agrega o actualiza un ingrediente
router.post('/', (req, res) => {
  const item = guardarIngrediente(req.usuario.id, req.body || {});
  if (!item) return res.status(400).json({ error: 'Escribe el nombre del ingrediente.' });
  res.status(201).json({ item, despensa: despensaDe(req.usuario.id) });
});

// PATCH /api/despensa/:id { nivel?, categoria? }
router.patch('/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM despensa WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Ingrediente no encontrado en tu despensa.' });
  const b = req.body || {};
  db.prepare("UPDATE despensa SET nivel = ?, categoria = ?, actualizado_en = datetime('now') WHERE id = ?").run(
    b.nivel !== undefined ? normNivel(b.nivel) : it.nivel,
    b.categoria !== undefined ? normCat(b.categoria) : it.categoria,
    it.id
  );
  res.json({ item: db.prepare('SELECT * FROM despensa WHERE id = ?').get(it.id), despensa: despensaDe(req.usuario.id) });
});

// DELETE /api/despensa/:id -> se acabo / ya no lo tengo
router.delete('/:id', (req, res) => {
  const it = db.prepare('SELECT id FROM despensa WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Ingrediente no encontrado en tu despensa.' });
  db.prepare('DELETE FROM despensa WHERE id = ?').run(it.id);
  res.json({ mensaje: 'Quitado de la despensa.', despensa: despensaDe(req.usuario.id) });
});

// POST /api/despensa/compra { semana?, nota?, items: [{nombre, categoria?, nivel?}] }
// Registra la COMPRA SEMANAL completa de una vez: crea la cabecera y vuelca sus items
// a la despensa. Todo en una transaccion: una compra a medias dejaria a la IA
// proponiendo platos con ingredientes que el usuario no llego a registrar.
router.post('/compra', (req, res) => {
  const semana = lunesDe(req.body?.semana);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Agrega al menos un ingrediente a la compra.' });

  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO compras (usuario_id, semana, nota) VALUES (?, ?, ?)')
      .run(req.usuario.id, semana, String(req.body?.nota || '').trim().slice(0, 200) || null);
    const compraId = info.lastInsertRowid;
    let n = 0;
    for (const it of items) {
      if (guardarIngrediente(req.usuario.id, { ...it, origen: 'compra', compraId })) n++;
    }
    db.prepare('UPDATE compras SET total_items = ? WHERE id = ?').run(n, compraId);
    return { compraId, n };
  });

  const { compraId, n } = tx();
  res.status(201).json({
    mensaje: `Compra registrada: ${n} ingrediente(s) en tu despensa.`,
    compra_id: compraId,
    semana,
    guardados: n,
    despensa: despensaDe(req.usuario.id),
  });
});

// GET /api/despensa/compras -> historial de compras del usuario.
// total_items = lo que traia la compra ; vigentes = cuantos siguen en la despensa hoy.
router.get('/compras', (req, res) => {
  const compras = db.prepare(
    `SELECT c.id, c.semana, c.nota, c.total_items,
            strftime('%Y-%m-%d %H:%M', c.creado_en, '-5 hours') AS creado_local,
            (SELECT COUNT(*) FROM despensa d WHERE d.compra_id = c.id) AS vigentes
     FROM compras c WHERE c.usuario_id = ? ORDER BY c.id DESC LIMIT 20`
  ).all(req.usuario.id);
  res.json({ compras });
});

module.exports = router;
