// "Mis compras": la forma PRACTICA de registrar una compra — la que se usa de pie en el
// supermercado, marcando producto por producto, con su cantidad y su precio.
//
// Convive con "Registrar compra" de la despensa, que es un checklist rapido de lo que trajiste.
// Esta otra sirve para OTRA cosa: llevar la cuenta del gasto. Por eso guarda precio por item,
// presupuesto por compra y un historico con totales.
//
// SE ASOCIA A LA DESPENSA: lo que se marca como comprado entra al inventario, igual que en el
// otro camino. Pero el registro se guarda SIEMPRE, tenga el usuario la despensa activa o no:
// llevar la cuenta de lo que gasta no deberia depender de si lleva inventario.
const express = require('express');
const {
  db, lunesDe, fechaPeru, sumarDias, clampPct, nivelDePorcentaje, CATEGORIAS_ING, claveIng,
} = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador } = require('../middleware/planificador');

const router = express.Router();
router.use(requiereAuth, requierePlanificador);

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const normFecha = (v, porDefecto) => (FECHA_RE.test(String(v || '')) ? v : porDefecto);
const normCat = (v) => (CATEGORIAS_ING.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'otro');
// El precio es OPCIONAL: quien no quiera llevar la cuenta deja el campo vacio y la compra se
// guarda igual. Un texto que no sea un numero se trata como "sin precio", no como 0: un 0
// falso ensuciaria el total y el usuario creeria que gasto menos.
function normPrecio(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
const normPresupuesto = normPrecio;

// Una compra con sus totales calculados. El total se SUMA de los items en vez de guardarse:
// los items se pueden editar despues (marcar uno mas, corregir un precio) y un total guardado
// se quedaria viejo sin que nadie lo note.
function compraPublica(fila) {
  const items = db.prepare('SELECT * FROM compra_items WHERE compra_id = ? ORDER BY categoria, nombre').all(fila.id);
  const comprados = items.filter((i) => i.comprado);
  const gastado = comprados.reduce((n, i) => n + (i.precio || 0), 0);
  const conPrecio = comprados.filter((i) => i.precio != null).length;
  // El presupuesto por producto suma TODOS los de la lista, no solo los comprados: lo que se
  // quiere comparar es "lo que pensaba gastar" contra "lo que gaste", y descontar del plan lo
  // que al final no compraste haria que la comparacion cuadrase siempre.
  const presupuestado = items.reduce((n, i) => n + (i.presupuesto || 0), 0);
  const conPresupuesto = items.filter((i) => i.presupuesto != null).length;
  return {
    ...fila,
    items,
    total_comprados: comprados.length,
    total_items: items.length,
    // Cuantos de los comprados traen precio: sin este dato, un total bajo puede significar
    // "gaste poco" o "no anote los precios", que son cosas muy distintas.
    con_precio: conPrecio,
    gastado: Math.round(gastado * 100) / 100,
    presupuesto: fila.presupuesto,
    diferencia: fila.presupuesto == null ? null : Math.round((fila.presupuesto - gastado) * 100) / 100,
    // Presupuesto POR PRODUCTO (la columna opcional). Va aparte del de la semana: son dos
    // formas distintas de presupuestar y el usuario puede usar una, la otra o las dos.
    presupuestado_items: conPresupuesto ? Math.round(presupuestado * 100) / 100 : null,
    con_presupuesto: conPresupuesto,
    diferencia_items: conPresupuesto ? Math.round((presupuestado - gastado) * 100) / 100 : null,
  };
}

// GET /api/compras -> historico, lo mas reciente primero, con el acumulado.
router.get('/', (req, res) => {
  const filas = db.prepare('SELECT * FROM compras WHERE usuario_id = ? ORDER BY id DESC LIMIT 60').all(req.usuario.id);
  const compras = filas.map(compraPublica);
  res.json({
    compras,
    resumen: {
      total_compras: compras.length,
      gastado_total: Math.round(compras.reduce((n, c) => n + c.gastado, 0) * 100) / 100,
      presupuestado_total: Math.round(compras.reduce((n, c) => n + (c.presupuesto || 0), 0) * 100) / 100,
    },
  });
});

// ===== Productos archivados de la lista =====
//
// OJO: estas rutas van ANTES de /:id. Declaradas despues, Express leeria "archivados" como el
// id de una compra y devolveria 404.
const archivadosDe = (usuarioId) =>
  db.prepare('SELECT id, nombre, clave, platos, creado_en FROM compras_archivados WHERE usuario_id = ? ORDER BY nombre')
    .all(usuarioId)
    .map((a) => {
      let platos = [];
      try { platos = JSON.parse(a.platos || '[]'); } catch { platos = []; }
      return { ...a, platos: Array.isArray(platos) ? platos : [] };
    });

// GET /api/compras/archivados -> lo que el usuario quito de su lista
router.get('/archivados', (req, res) => {
  res.json({ archivados: archivadosDe(req.usuario.id) });
});

// POST /api/compras/archivados { nombre } -> quitar un producto de la lista, para siempre
router.post('/archivados', (req, res) => {
  const nombre = String(req.body?.nombre || '').trim().slice(0, 80);
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del producto.' });
  const clave = claveIng(nombre);
  if (!clave) return res.status(400).json({ error: 'Ese nombre no es valido.' });
  // Los platos que lo pedian AHORA. Es la foto contra la que se compara despues: si mañana lo
  // pide un plato que no esta en esta lista, el producto vuelve a salir solo.
  const platos = (Array.isArray(req.body?.platos) ? req.body.platos : [])
    .map((p) => String(p || '').trim().slice(0, 120)).filter(Boolean).slice(0, 30);

  // Archivar dos veces el mismo producto no es un error: el usuario no tiene por que saber si ya
  // estaba. Y se ACTUALIZA la foto de platos, que es justo lo que pasa cuando alguien vuelve a
  // quitarlo despues de que reaparecio por un plato nuevo.
  db.prepare(
    `INSERT INTO compras_archivados (usuario_id, nombre, clave, platos) VALUES (?, ?, ?, ?)
     ON CONFLICT (usuario_id, clave) DO UPDATE SET nombre = excluded.nombre, platos = excluded.platos`
  ).run(req.usuario.id, nombre, clave, JSON.stringify(platos));
  res.json({ mensaje: `"${nombre}" no volvera a salir en tu lista.`, archivados: archivadosDe(req.usuario.id) });
});

// DELETE /api/compras/archivados/:id -> devolverlo a la lista
router.delete('/archivados/:id', (req, res) => {
  const r = db.prepare('DELETE FROM compras_archivados WHERE id = ? AND usuario_id = ?')
    .run(Number(req.params.id), req.usuario.id);
  if (!r.changes) return res.status(404).json({ error: 'Ese producto no esta en tu archivo.' });
  res.json({ mensaje: 'Vuelve a estar en tu lista.', archivados: archivadosDe(req.usuario.id) });
});

// GET /api/compras/:id
router.get('/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM compras WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!f) return res.status(404).json({ error: 'Esa compra no esta en tu historial.' });
  res.json({ compra: compraPublica(f) });
});

// Mete en la despensa lo que se marco como comprado. Solo si el modulo esta activo: con la
// despensa apagada la compra se registra igual (es un gasto), pero no hay inventario que tocar.
function volcarADespensa(usuarioId, items) {
  const hogar = db.prepare('SELECT despensa_activa FROM hogar WHERE usuario_id = ?').get(usuarioId);
  if (!hogar || !hogar.despensa_activa) return 0;

  let n = 0;
  for (const it of items) {
    if (!it.comprado) continue;
    // 100%: se acaba de comprar, asi que tiene todo lo que su plan necesita del periodo.
    const pct = clampPct(100);
    const existe = db.prepare('SELECT id FROM despensa WHERE usuario_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))')
      .get(usuarioId, it.nombre);
    if (existe) {
      db.prepare("UPDATE despensa SET porcentaje = ?, nivel = ?, actualizado_en = datetime('now') WHERE id = ?")
        .run(pct, nivelDePorcentaje(pct), existe.id);
    } else {
      db.prepare('INSERT INTO despensa (usuario_id, nombre, categoria, nivel, porcentaje, origen) VALUES (?, ?, ?, ?, ?, ?)')
        .run(usuarioId, it.nombre, it.categoria, nivelDePorcentaje(pct), pct, 'compra');
    }
    n++;
  }
  return n;
}

// Normaliza los items que manda el cliente. Se descarta lo que no tenga nombre: una fila vacia
// del formulario no es un producto.
function itemsEntrantes(body, fechaCompra) {
  return (Array.isArray(body?.items) ? body.items : [])
    .map((i) => ({
      nombre: String(i?.nombre || '').trim().slice(0, 80),
      categoria: normCat(i?.categoria),
      cantidad: i?.cantidad ? String(i.cantidad).trim().slice(0, 40) : null,
      precio: normPrecio(i?.precio),
      // Mismo criterio que el precio: un texto que no es numero es "sin presupuesto", no 0.
      presupuesto: normPrecio(i?.presupuesto),
      comprado: i?.comprado ? 1 : 0,
      fecha_compra: normFecha(i?.fecha_compra, fechaCompra),
    }))
    .filter((i) => i.nombre)
    .slice(0, 200);
}

// POST /api/compras -> guarda una compra nueva
router.post('/', (req, res) => {
  const usuario = req.usuario;
  const hoy = fechaPeru();
  const fecha = normFecha(req.body?.fecha, hoy);
  const inicio = normFecha(req.body?.periodo_inicio, lunesDe(fecha));
  const fin = normFecha(req.body?.periodo_fin, sumarDias(inicio, 6));
  const presupuesto = normPresupuesto(req.body?.presupuesto);
  const items = itemsEntrantes(req.body, fecha);
  if (!items.length) return res.status(400).json({ error: 'Agrega al menos un producto a la lista.' });

  let id;
  // Todo en UNA transaccion: una compra a medias (cabecera sin items, o items sin volcar a la
  // despensa) dejaria el gasto o el inventario mintiendo.
  db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO compras (usuario_id, semana, periodo_inicio, periodo_fin, fecha, presupuesto, nota, total_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(usuario.id, lunesDe(inicio), inicio, fin, fecha, presupuesto,
      req.body?.nota ? String(req.body.nota).trim().slice(0, 200) : null,
      items.filter((i) => i.comprado).length);
    id = info.lastInsertRowid;

    const ins = db.prepare(
      `INSERT INTO compra_items (compra_id, nombre, categoria, nivel, cantidad, precio, presupuesto, comprado, fecha_compra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const it of items) {
      ins.run(id, it.nombre, it.categoria, 'bastante', it.cantidad, it.precio, it.presupuesto, it.comprado, it.comprado ? it.fecha_compra : null);
    }
    volcarADespensa(usuario.id, items);
  })();

  const compra = compraPublica(db.prepare('SELECT * FROM compras WHERE id = ?').get(id));
  res.status(201).json({
    compra,
    mensaje: `Compra del ${fecha} guardada: ${compra.total_comprados} producto(s)`
      + (compra.gastado ? `, S/ ${compra.gastado.toFixed(2)}.` : '.'),
  });
});

// PATCH /api/compras/:id -> corregir una compra ya guardada (precios, marcados, presupuesto)
router.patch('/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM compras WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!f) return res.status(404).json({ error: 'Esa compra no esta en tu historial.' });

  db.transaction(() => {
    if (req.body?.presupuesto !== undefined) {
      db.prepare('UPDATE compras SET presupuesto = ? WHERE id = ?').run(normPresupuesto(req.body.presupuesto), f.id);
    }
    if (req.body?.fecha !== undefined) {
      db.prepare('UPDATE compras SET fecha = ? WHERE id = ?').run(normFecha(req.body.fecha, f.fecha), f.id);
    }
    // Los items se reemplazan enteros: el formulario manda siempre la lista completa, y
    // reconciliar altas/bajas/ediciones una por una seria mas codigo para el mismo resultado.
    if (Array.isArray(req.body?.items)) {
      const items = itemsEntrantes(req.body, f.fecha || fechaPeru());
      db.prepare('DELETE FROM compra_items WHERE compra_id = ?').run(f.id);
      const ins = db.prepare(
        `INSERT INTO compra_items (compra_id, nombre, categoria, nivel, cantidad, precio, presupuesto, comprado, fecha_compra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const it of items) {
        ins.run(f.id, it.nombre, it.categoria, 'bastante', it.cantidad, it.precio, it.presupuesto, it.comprado, it.comprado ? it.fecha_compra : null);
      }
      db.prepare('UPDATE compras SET total_items = ? WHERE id = ?').run(items.filter((i) => i.comprado).length, f.id);
      volcarADespensa(req.usuario.id, items);
    }
  })();

  res.json({ compra: compraPublica(db.prepare('SELECT * FROM compras WHERE id = ?').get(f.id)), mensaje: 'Compra actualizada.' });
});

// DELETE /api/compras/:id
// Borra el REGISTRO del gasto, NO el stock: misma regla que el historial de la despensa
// (compra_items se va por CASCADE y despensa.compra_id queda en NULL por el SET NULL).
router.delete('/:id', (req, res) => {
  const f = db.prepare('SELECT id FROM compras WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!f) return res.status(404).json({ error: 'Esa compra no esta en tu historial.' });
  db.prepare('DELETE FROM compras WHERE id = ?').run(f.id);
  res.json({ mensaje: 'Se borro el registro de esa compra. Tu despensa no cambio.' });
});

module.exports = router;
