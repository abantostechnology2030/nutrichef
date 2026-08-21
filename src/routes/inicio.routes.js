// Dashboard de bienvenida: lo primero que ve el usuario al entrar.
//
// UNA sola llamada devuelve todo lo que pinta la pagina. Podria armarse desde el cliente
// juntando /api/plan, /api/despensa, /api/platos y /api/hogar, pero serian cuatro peticiones
// para la pantalla de arranque —la que mas se abre— y ademas cada una trae cargas completas
// (todos los platos, toda la despensa) para acabar mostrando un numero.
//
// NO usa IA ni consume cupo: son conteos sobre datos que ya estan en la BD.
const express = require('express');
const {
  db, lunesDe, fechaPeru, sumarDias, DIA_NUM, MOMENTOS, usuarioPublico,
} = require('../db');
const { requiereAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requiereAuth);

// Fecha real (YYYY-MM-DD) de una casilla: la BD guarda dia 0=Domingo (como Date.getDay()),
// pero la semana empieza el LUNES, asi que el domingo es el SEPTIMO dia. Mismo criterio que
// plan.routes.js y consumo.js: si aqui se calculara distinto, el dashboard mostraria como
// "hoy" los platos de otro dia.
const fechaCasilla = (semana, dia) => sumarDias(semana, DIA_NUM.indexOf(dia));

router.get('/', (req, res) => {
  const u = req.usuario;
  const hoy = fechaPeru();
  const lunes = lunesDe(hoy);
  const diaHoy = new Date(hoy + 'T00:00:00Z').getUTCDay(); // 0=Domingo, igual que la BD

  // ===== Los platos de HOY =====
  // Se piden por (semana, dia) y no filtrando por fecha calculada, porque esa pareja es
  // justamente la clave UNIQUE de la casilla.
  const filas = db.prepare(
    `SELECT pc.momento, pc.cocinado, p.id, p.nombre, p.tiempo_min, p.porciones, p.info, p.momento AS p_momento
     FROM plan_comidas pc JOIN platos p ON p.id = pc.plato_id
     WHERE pc.usuario_id = ? AND pc.semana = ? AND pc.dia = ?`
  ).all(u.id, lunes, diaHoy);

  const porMomento = new Map(filas.map((f) => [f.momento, f]));
  const hoy_platos = MOMENTOS.map((m) => {
    const f = porMomento.get(m);
    if (!f) return { momento: m, plato: null };
    let info = null;
    try { info = f.info ? JSON.parse(f.info) : null; } catch { /* info corrupta: se ignora */ }
    return {
      momento: m,
      cocinado: !!f.cocinado,
      plato: { id: f.id, nombre: f.nombre, tiempo_min: f.tiempo_min, porciones: f.porciones, info },
    };
  });

  // ===== Estadisticas de uso =====
  const uno = (sql, ...args) => db.prepare(sql).get(...args);

  const semanas_programadas = uno('SELECT COUNT(DISTINCT semana) c FROM plan_comidas WHERE usuario_id = ?', u.id).c;
  const casillas_llenas = uno('SELECT COUNT(*) c FROM plan_comidas WHERE usuario_id = ?', u.id).c;
  const platos_guardados = uno('SELECT COUNT(*) c FROM platos WHERE usuario_id = ? AND guardado = 1', u.id).c;
  const platos_creados = uno('SELECT COUNT(*) c FROM platos WHERE usuario_id = ?', u.id).c;

  const desp = db.prepare('SELECT porcentaje FROM despensa WHERE usuario_id = ?').all(u.id);
  // "Consumo total": cuanto se ha gastado de lo que se compro, en promedio. Se mide sobre lo
  // que QUEDA (100 - promedio) porque el 100% significa "tengo todo lo que el plan necesita
  // para el periodo" — ver el punto rojo de "Consumo de la despensa" en CLAUDE.md.
  const consumo_despensa = desp.length
    ? Math.round(100 - desp.reduce((n, d) => n + d.porcentaje, 0) / desp.length)
    : 0;
  const despensa_agotados = desp.filter((d) => d.porcentaje <= 10).length;

  const hogar = uno('SELECT id, nombre, region, ciudad, semanas, configurado FROM hogar WHERE usuario_id = ?', u.id);
  const integrantes = hogar ? uno('SELECT COUNT(*) c FROM integrantes WHERE hogar_id = ?', hogar.id).c : 0;

  // Uso de IA: las DOS fuentes, igual que el panel admin. Contar solo una dejaria fuera la
  // mitad del gasto (el escaner o el planificador, segun cual se mire).
  const generaciones_total = uno('SELECT COUNT(*) c FROM generaciones WHERE usuario_id = ?', u.id).c;
  const generaciones_semana = uno('SELECT COUNT(*) c FROM generaciones WHERE usuario_id = ? AND semana = ?', u.id, lunes).c;
  const analisis_total = uno('SELECT COUNT(*) c FROM analisis WHERE usuario_id = ?', u.id).c;

  // ===== Periodo activo (la ultima compra registrada) =====
  const compra = uno(
    'SELECT id, periodo_inicio, periodo_fin, total_items, creado_en FROM compras WHERE usuario_id = ? ORDER BY id DESC LIMIT 1',
    u.id
  );

  res.json({
    hoy,
    semana: lunes,
    usuario: usuarioPublico(u.id),
    hogar: hogar || null,
    hoy_platos,
    compra: compra || null,
    stats: {
      semanas_programadas,
      casillas_llenas,
      platos_guardados,
      platos_creados,
      despensa_productos: desp.length,
      despensa_agotados,
      consumo_despensa,
      integrantes,
      generaciones_total,
      generaciones_semana,
      analisis_total,
    },
  });
});

module.exports = router;
