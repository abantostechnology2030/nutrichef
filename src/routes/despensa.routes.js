// Rutas de la DESPENSA: el inventario de lo que el usuario tiene en casa, y la
// COMPRA SEMANAL que lo abastece. Es la entrada del planificador: la IA propone
// platos a partir de esto.
//
// Inventario por PORCENTAJE de lo que queda (0-100), no por gramos: descontar gramos
// exigiria conversion de unidades y mermas, y la familia razona en "ya casi no me queda".
// El porcentaje es la fuente de verdad y "nivel" (poco|normal|bastante) es un campo
// DERIVADO que solo existe para el prompt de la IA y el snapshot de compra_items.
//
// Lo que baja el porcentaje es el consumo de los platos programados, y SOLO cuando se
// marcan como cocinados (ver services/consumo.js y PATCH /api/plan/:id). Mientras la
// casilla no se cocina, lo que se ve es una PROYECCION que no toca la BD.
//
// No usa IA ni consume analisis: el gate es el plan.
const express = require('express');
const {
  db, lunesDe, periodoSemanas, fechaPeru, sumarDias,
  CATEGORIAS_ING, NIVELES, clampPct, nivelDePorcentaje, porcentajeDeNivel,
} = require('../db');
const { consumoPrevisto } = require('../services/consumo');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador } = require('../middleware/planificador');

const router = express.Router();
router.use(requiereAuth, requierePlanificador);

const normCat = (v) => (CATEGORIAS_ING.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'otro');
const normNivel = (v) => (NIVELES.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'normal');

// El cliente puede mandar "porcentaje" (la barra) o "nivel" (el select de agregar, que es
// mas comodo justo despues de comprar). Se acepta cualquiera de los dos y siempre se
// termina guardando un porcentaje: una sola escala en la BD, dos formas de escribirla.
function porcentajeEntrante({ porcentaje, nivel }, actual = 100) {
  if (porcentaje !== undefined && porcentaje !== null && porcentaje !== '' && Number.isFinite(Number(porcentaje))) {
    return clampPct(porcentaje);
  }
  if (nivel !== undefined) return porcentajeDeNivel(normNivel(nivel));
  return clampPct(actual);
}

// Categoria por defecto de un ingrediente: la del catalogo del admin si existe.
// Asi el usuario no tiene que clasificar "Rocoto" a mano si ya esta en el catalogo.
function categoriaSugerida(nombre, fallback) {
  if (fallback) return normCat(fallback);
  const hit = db.prepare('SELECT categoria FROM ingredientes_catalogo WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1').get(nombre);
  return hit ? hit.categoria : 'otro';
}

const despensaDe = (usuarioId) =>
  db.prepare('SELECT * FROM despensa WHERE usuario_id = ? ORDER BY categoria, nombre').all(usuarioId);

// La despensa MAS la proyeccion de lo que se va a consumir en una ventana de fechas.
// Por cada producto agrega:
//   consumo_previsto -> puntos de porcentaje que se llevan las casillas NO cocinadas
//   restante         -> con cuanto se queda si se cocina todo lo programado
// Es una proyeccion: NO se ha escrito nada en la BD (eso pasa al marcar cocinado).
function despensaConProyeccion(usuarioId, inicio, fin) {
  const previsto = consumoPrevisto(usuarioId, inicio, fin);
  return despensaDe(usuarioId).map((d) => {
    const consumo = Math.min(d.porcentaje, Math.round(previsto.get(d.id) || 0));
    return { ...d, consumo_previsto: consumo, restante: clampPct(d.porcentaje - consumo) };
  });
}

// Agrega o actualiza un ingrediente de la despensa. Hay un UNIQUE por (usuario, nombre
// normalizado), asi que un mismo ingrediente NUNCA se duplica: se le actualiza el stock.
// Se resuelve a mano (en vez de ON CONFLICT) porque el indice es sobre una expresion.
//
// "nivel" NUNCA se escribe suelto: siempre se deriva del porcentaje que se acaba de
// guardar, para que no puedan contradecirse (una barra al 10% con la etiqueta "bastante").
function guardarIngrediente(usuarioId, { nombre, categoria, nivel, porcentaje, origen = 'manual', compraId = null }) {
  const limpio = String(nombre || '').trim().slice(0, 80);
  if (!limpio) return null;

  const existe = db.prepare('SELECT * FROM despensa WHERE usuario_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))').get(usuarioId, limpio);
  if (existe) {
    const pct = porcentajeEntrante({ porcentaje, nivel }, existe.porcentaje);
    db.prepare("UPDATE despensa SET porcentaje = ?, nivel = ?, categoria = ?, origen = ?, compra_id = ?, actualizado_en = datetime('now') WHERE id = ?")
      .run(pct, nivelDePorcentaje(pct), categoria ? normCat(categoria) : existe.categoria, origen, compraId, existe.id);
    return db.prepare('SELECT * FROM despensa WHERE id = ?').get(existe.id);
  }
  // Un producto que se agrega por primera vez se asume LLENO (100%): lo normal es que se
  // agregue justo despues de comprarlo. El select de nivel del formulario lo puede bajar.
  const pct = porcentajeEntrante({ porcentaje, nivel }, 100);
  const info = db.prepare('INSERT INTO despensa (usuario_id, nombre, categoria, nivel, porcentaje, origen, compra_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(usuarioId, limpio, categoriaSugerida(limpio, categoria), nivelDePorcentaje(pct), pct, origen, compraId);
  return db.prepare('SELECT * FROM despensa WHERE id = ?').get(info.lastInsertRowid);
}

// Ventana de proyeccion pedida por el cliente. Por defecto, la SEMANA ACTUAL: es la
// unidad en la que se edita el plan y la que el usuario tiene delante al mirar su despensa.
function ventanaDe(query) {
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(query.inicio || '') ? query.inicio : lunesDe(fechaPeru());
  const fin = /^\d{4}-\d{2}-\d{2}$/.test(query.fin || '') ? query.fin : sumarDias(inicio, 6);
  return fin < inicio ? { inicio: fin, fin: inicio } : { inicio, fin };
}

// GET /api/despensa?inicio=&fin=  -> inventario (con la proyeccion de consumo de esa
// ventana) + catalogo activo (para elegir rapido) + opciones
router.get('/', (req, res) => {
  const { inicio, fin } = ventanaDe(req.query || {});
  res.json({
    despensa: despensaConProyeccion(req.usuario.id, inicio, fin),
    ventana: { inicio, fin },
    catalogo: db.prepare('SELECT id, nombre, categoria FROM ingredientes_catalogo WHERE activo = 1 ORDER BY categoria, nombre').all(),
    categorias: CATEGORIAS_ING,
    niveles: NIVELES,
  });
});

// POST /api/despensa { nombre, categoria?, nivel?, porcentaje? } -> agrega o actualiza
router.post('/', (req, res) => {
  const item = guardarIngrediente(req.usuario.id, req.body || {});
  if (!item) return res.status(400).json({ error: 'Escribe el nombre del ingrediente.' });
  const { inicio, fin } = ventanaDe(req.query || {});
  res.status(201).json({ item, despensa: despensaConProyeccion(req.usuario.id, inicio, fin) });
});

// PATCH /api/despensa/:id { porcentaje?, nivel?, categoria? }
// El porcentaje editado A MANO manda sobre cualquier proyeccion: el usuario es el unico
// que sabe de verdad cuanto le queda en la olla.
router.patch('/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM despensa WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Ingrediente no encontrado en tu despensa.' });
  const b = req.body || {};
  const pct = porcentajeEntrante(b, it.porcentaje);
  db.prepare("UPDATE despensa SET porcentaje = ?, nivel = ?, categoria = ?, actualizado_en = datetime('now') WHERE id = ?").run(
    pct,
    nivelDePorcentaje(pct),
    b.categoria !== undefined ? normCat(b.categoria) : it.categoria,
    it.id
  );
  const { inicio, fin } = ventanaDe(req.query || {});
  res.json({
    item: db.prepare('SELECT * FROM despensa WHERE id = ?').get(it.id),
    despensa: despensaConProyeccion(req.usuario.id, inicio, fin),
  });
});

// DELETE /api/despensa/:id -> se acabo / ya no lo tengo
router.delete('/:id', (req, res) => {
  const it = db.prepare('SELECT id FROM despensa WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Ingrediente no encontrado en tu despensa.' });
  db.prepare('DELETE FROM despensa WHERE id = ?').run(it.id);
  const { inicio, fin } = ventanaDe(req.query || {});
  res.json({ mensaje: 'Quitado de la despensa.', despensa: despensaConProyeccion(req.usuario.id, inicio, fin) });
});

// Cada producto marcado en la compra, con CUANTO se compro de el (0-100).
//
// Se aceptan dos formas de "items" a proposito:
//   ["Arroz", "Pollo"]                      -> lo comprado se asume LLENO (100%)
//   [{ nombre: "Arroz", porcentaje: 60 }]   -> cuanto se compro de cada uno
// La primera existe porque es lo que mandaba el cliente antes de que la compra tuviera
// barras, y porque "compre este producto" sin mas detalle sigue siendo una respuesta valida.
// La segunda es mas exacta: no es lo mismo traer el saco de arroz que medio kilo.
//
// El porcentaje es la MISMA escala que la barra de la despensa ("que fraccion de lo que
// suelo tener"), no una cantidad absoluta: seguimos sin gramos (ver la cabecera del archivo).
function itemsComprados(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const obj = x && typeof x === 'object';
    const nombre = String((obj ? x.nombre : x) || '').trim();
    if (!nombre) continue;
    out.push({ nombre, porcentaje: porcentajeEntrante(obj ? x : {}, 100) });
  }
  return out;
}

// POST /api/despensa/compra { semanas?, periodo_inicio?, periodo_fin?, nota?, items: [...] }
// "Registrar compra": guarda como la compra de un periodo los productos que el usuario MARCO
// como comprados (ver itemsComprados: nombre + cuanto compro). La categoria NO se toma del
// cliente: se resuelve contra la despensa (fuente de verdad). El detalle se congela en
// compra_items para el historial. NO reinicia la despensa: los productos que NO se marcaron
// conservan su stock.
//
// Lo que SI hace con los marcados es dejarlos en el porcentaje que el usuario declaro (100%
// si no dijo nada): acabas de comprarlos, ese es el punto de partida de la barra, y cierra
// el ciclo comprar -> cocinar -> se vacia -> vuelve a la lista de compras.
//
// El periodo se define de dos formas:
//   - N SEMANAS enteras (semanas): inicio = lunes; fin = inicio + N*7 - 1. Preferencia sticky.
//   - FECHAS MANUALES (periodo_inicio + periodo_fin): el usuario fija el rango a medida.
router.post('/compra', (req, res) => {
  const b = req.body || {};
  const marcados = itemsComprados(b.items);
  if (!marcados.length) return res.status(400).json({ error: 'Marca al menos un producto que compraste.' });

  const manualIni = /^\d{4}-\d{2}-\d{2}$/.test(b.periodo_inicio || '');
  const manualFin = /^\d{4}-\d{2}-\d{2}$/.test(b.periodo_fin || '');
  let inicio;
  let fin;
  let semanas = null; // null = periodo a medida (fechas manuales)
  if (manualIni && manualFin) {
    inicio = b.periodo_inicio;
    fin = b.periodo_fin;
    if (fin < inicio) [inicio, fin] = [fin, inicio];
  } else {
    const semHogar = db.prepare('SELECT semanas FROM hogar WHERE usuario_id = ?').get(req.usuario.id)?.semanas;
    const p = periodoSemanas(b.periodo_inicio, b.semanas || semHogar || 1);
    inicio = p.inicio; fin = p.fin; semanas = p.semanas;
  }
  const semana = lunesDe(inicio);

  // TODO va en una transaccion, incluida el alta de los productos nuevos: una compra a
  // medias dejaria a la IA proponiendo platos con ingredientes que el usuario no llego a
  // registrar, o productos dados de alta sin la compra que los explica.
  const tx = db.transaction(() => {
    // Resolver cada nombre marcado contra la despensa. Lo que NO este todavia se DA DE ALTA:
    // el checklist ofrece tambien los faltantes de la lista de compras (lo que la IA dijo
    // que le falta para su plan), y esos son justo los que uno trae del mercado. Obligar a
    // agregarlos uno por uno con "+ Agregar" antes de poder marcarlos era el camino largo
    // para el caso mas comun. La categoria sale del catalogo, nunca del cliente.
    const buscar = db.prepare('SELECT id, nombre, categoria FROM despensa WHERE usuario_id = ? AND LOWER(TRIM(nombre)) = LOWER(TRIM(?))');
    const comprados = [];
    const vistos = new Set();
    let nuevos = 0;
    for (const m of marcados) {
      const clave = m.nombre.toLowerCase();
      if (vistos.has(clave)) continue;
      let it = buscar.get(req.usuario.id, m.nombre);
      if (!it) {
        // guardarIngrediente resuelve el UNIQUE a mano y hereda la categoria del catalogo.
        const creado = guardarIngrediente(req.usuario.id, { nombre: m.nombre, porcentaje: m.porcentaje, origen: 'compra' });
        if (!creado) continue; // nombre vacio tras limpiar
        it = { id: creado.id, nombre: creado.nombre, categoria: creado.categoria };
        nuevos++;
      }
      comprados.push({ ...it, porcentaje: m.porcentaje });
      vistos.add(clave);
    }
    if (!comprados.length) return null;

    // N semanas queda como preferencia sticky del hogar (las fechas a medida no la tocan).
    if (semanas) db.prepare('UPDATE hogar SET semanas = ? WHERE usuario_id = ?').run(semanas, req.usuario.id);
    const info = db.prepare(
      'INSERT INTO compras (usuario_id, semana, periodo_inicio, periodo_fin, nota, total_items) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.usuario.id, semana, inicio, fin, String(b.nota || '').trim().slice(0, 200) || null, comprados.length);
    const compraId = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO compra_items (compra_id, nombre, categoria, nivel) VALUES (?, ?, ?, ?)');
    // Lo comprado queda en el porcentaje declarado (100% si el cliente no dijo cuanto), con
    // el nivel DERIVADO de ese porcentaje — nunca escrito suelto, como en el resto del
    // archivo. El snapshot congela ese mismo estado: es el que tenia el producto AL
    // COMPRARLO, que es lo que el historial debe recordar aunque despues se consuma.
    const reponer = db.prepare("UPDATE despensa SET porcentaje = ?, nivel = ?, compra_id = ?, actualizado_en = datetime('now') WHERE id = ?");
    for (const it of comprados) {
      const nivel = nivelDePorcentaje(it.porcentaje);
      ins.run(compraId, it.nombre, it.categoria, nivel);
      reponer.run(it.porcentaje, nivel, compraId, it.id);
    }
    return { compraId, guardados: comprados.length, nuevos };
  });

  const hecho = tx();
  if (!hecho) return res.status(400).json({ error: 'Marca al menos un producto que compraste.' });
  const { compraId, guardados, nuevos } = hecho;
  res.status(201).json({
    mensaje: 'Se guardo la despensa del periodo.',
    compra_id: compraId,
    periodo: { inicio, fin, semanas },
    guardados,
    nuevos, // cuantos entraron a la despensa por primera vez (venian de la lista de compras)
    // La proyeccion se devuelve sobre el PERIODO recien registrado, no sobre la semana
    // actual: es la ventana que el usuario acaba de declarar que esta comprando.
    despensa: despensaConProyeccion(req.usuario.id, inicio, fin),
  });
});

// DELETE /api/despensa/compras/:id -> borra un REGISTRO del historial de compras.
//
// Borra el REGISTRO, NO el stock. Es la distincion que importa: "compras" es el historial de
// "que traje del mercado y para que periodo", y la despensa es lo que hay en casa AHORA. Si
// borrar una compra vieja vaciara la despensa, el usuario perderia su inventario por limpiar
// una lista — y la IA planificaria alrededor de una casa vacia.
//
// Quien se encarga de que eso no pase es el esquema, no esta ruta:
//   - compra_items      -> ON DELETE CASCADE  (el detalle congelado se va con su compra)
//   - despensa.compra_id -> ON DELETE SET NULL (el producto se queda; pierde solo el vinculo)
// Si algun dia cambias esos FK, esta ruta se vuelve destructiva sin tocarla. No los cambies.
//
// Efecto secundario que SI tiene y el cliente debe avisar: el banner de la despensa y el badge
// del plan leen la compra MAS RECIENTE. Borrando esa, el "periodo activo" pasa a ser el de la
// anterior (o ninguno). No es un dato que se pierda, pero la pantalla cambia.
router.delete('/compras/:id', (req, res) => {
  const it = db.prepare('SELECT id, periodo_inicio, periodo_fin FROM compras WHERE id = ? AND usuario_id = ?')
    .get(Number(req.params.id), req.usuario.id);
  if (!it) return res.status(404).json({ error: 'Esa compra no esta en tu historial.' });

  const vinculados = db.prepare('SELECT COUNT(*) c FROM despensa WHERE usuario_id = ? AND compra_id = ?')
    .get(req.usuario.id, it.id).c;
  db.prepare('DELETE FROM compras WHERE id = ?').run(it.id);

  const { inicio, fin } = ventanaDe(req.query || {});
  res.json({
    mensaje: 'Se borro el registro de esa compra. Tu despensa no cambio.',
    // Cuantos productos quedaron sin vinculo (siguen en la despensa con su stock intacto):
    // le sirve al cliente para decirlo sin tener que deducirlo.
    desvinculados: vinculados,
    despensa: despensaConProyeccion(req.usuario.id, inicio, fin),
  });
});

// GET /api/despensa/compras -> historial de compras (snapshots) del usuario, con su detalle.
router.get('/compras', (req, res) => {
  const compras = db.prepare(
    `SELECT c.id, c.periodo_inicio, c.periodo_fin, c.nota, c.total_items,
            strftime('%Y-%m-%d %H:%M', c.creado_en, '-5 hours') AS creado_local
     FROM compras c WHERE c.usuario_id = ? ORDER BY c.id DESC LIMIT 20`
  ).all(req.usuario.id);
  const itemsStmt = db.prepare('SELECT nombre, categoria, nivel FROM compra_items WHERE compra_id = ? ORDER BY categoria, nombre');
  for (const c of compras) c.items = itemsStmt.all(c.id);
  res.json({ compras });
});

module.exports = router;
