// Rutas exclusivas del administrador: planes, pagos, usuarios y configuracion.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, getAllConfig, getConfig, setConfig, CATEGORIAS_ING, fechaPeru, sumarDias } = require('../db');

// Vigencia de un plan de pago al aprobarlo (mensual).
const DIAS_VIGENCIA = 30;
const { requiereAuth, requiereAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requiereAuth, requiereAdmin);

// Subida del QR de Yape (imagen que veran los clientes en el checkout).
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const uploadQr = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `yape_qr_${Date.now()}${path.extname(file.originalname) || '.png'}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('El QR debe ser una imagen JPG, PNG o WEBP.'));
  },
});

// Borra el archivo del QR anterior (si existe) del disco.
function borrarQrAnterior() {
  const anterior = getConfig('yape_qr_path');
  if (anterior) fs.unlink(path.join(__dirname, '..', '..', anterior.replace(/^\//, '')), () => {});
}

// Tarifas de referencia por 1M de tokens (USD).
const TARIFAS = {
  gemini: { in: 0.30, out: 2.50 }, // gemini-2.5-flash
  claude: { in: 3, out: 15 },      // claude-sonnet-4-6 (via gateway)
};

// ===== Resumen / metricas =====
router.get('/resumen', (req, res) => {
  const totalUsuarios = db.prepare("SELECT COUNT(*) c FROM usuarios WHERE rol = 'user'").get().c;
  const dePago = db
    .prepare("SELECT COUNT(*) c FROM usuarios u JOIN planes p ON p.id = u.plan_id WHERE u.rol = 'user' AND p.precio > 0")
    .get().c;
  const pendientes = db.prepare("SELECT COUNT(*) c FROM pagos WHERE estado = 'pendiente'").get().c;
  const totalAnalisis = db.prepare('SELECT COUNT(*) c FROM analisis').get().c;
  const totalPlatos = db.prepare('SELECT COUNT(*) c FROM platos').get().c;
  const totalGeneraciones = db.prepare('SELECT COUNT(*) c FROM generaciones').get().c;
  const totalHogares = db.prepare('SELECT COUNT(*) c FROM hogar WHERE configurado = 1').get().c;

  // Consumo por proveedor (cada uno con su tarifa) y saldo restante segun el credito cargado.
  // Suma las DOS fuentes de gasto de IA: el escaner (analisis) y el planificador
  // (generaciones). Contar solo el escaner subestimaria el costo real a la mitad.
  const filas = db.prepare(
    `SELECT prov, COALESCE(SUM(i),0) i, COALESCE(SUM(o),0) o FROM (
       SELECT COALESCE(NULLIF(proveedor,''),'?') prov, input_tokens i, output_tokens o FROM analisis
       UNION ALL
       SELECT COALESCE(NULLIF(proveedor,''),'?') prov, input_tokens i, output_tokens o FROM generaciones
     ) GROUP BY prov`
  ).all();
  const porProv = {};
  filas.forEach((f) => { porProv[f.prov] = { input: f.i, output: f.o }; });

  const bloque = (p) => {
    const t = porProv[p] || { input: 0, output: 0 };
    const tarifa = TARIFAS[p];
    const costo = (t.input / 1e6) * tarifa.in + (t.output / 1e6) * tarifa.out;
    const credito = parseFloat(getConfig('credito_' + p) || '0') || 0;
    const restante = credito - costo;
    const pct = credito > 0 ? Math.min(1, costo / credito) : 0;
    return {
      input: t.input, output: t.output, costo, credito, restante, pct, tarifa,
      bajo: credito > 0 && restante <= credito * 0.2,   // <= 20% del credito
      agotado: credito > 0 && restante <= 0,
    };
  };
  const ia = { gemini: bloque('gemini'), claude: bloque('claude') };

  const soporteNuevos = db.prepare("SELECT COUNT(*) c FROM soporte WHERE estado = 'nuevo'").get().c;

  res.json({
    totalUsuarios, dePago, pendientes, totalAnalisis, totalPlatos, totalGeneraciones, totalHogares, soporteNuevos,
    inputTokens: ia.gemini.input + ia.claude.input,
    outputTokens: ia.gemini.output + ia.claude.output,
    ia,
    ai_modo: getConfig('ai_modo', 'ambos'),
    ai_prioridad: getConfig('ai_prioridad', 'gemini'),
  });
});

// Reinicia el contador de consumo de IA (tokens/costo) SIN borrar nada del usuario:
// pone a cero los tokens de las dos fuentes (analisis y generaciones).
router.post('/tokens/reset', (req, res) => {
  const tx = db.transaction(() => {
    const a = db.prepare('UPDATE analisis SET input_tokens = 0, output_tokens = 0').run();
    const g = db.prepare('UPDATE generaciones SET input_tokens = 0, output_tokens = 0').run();
    return a.changes + g.changes;
  });
  res.json({ mensaje: 'Contador de consumo reiniciado.', afectadas: tx() });
});

// ===== PLANES (CRUD) =====
// Normaliza un limite: vacio/null/"ilimitado" -> NULL (sin tope)
function parseLimite(v) {
  if (v === null || v === undefined || v === '' || v === 'ilimitado') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : Math.max(0, n);
}
// Dias de vigencia: entero >= 1 (default 30).
function parseDias(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 1 ? 30 : n;
}

router.get('/planes', (req, res) => {
  const planes = db.prepare('SELECT * FROM planes ORDER BY precio, id').all();
  res.json({ planes });
});

router.post('/planes', (req, res) => {
  const { nombre, precio, analisis, historial_max, platos_max, semanas_max, generaciones_max, dias_vigencia, incluye_planificador, activo } = req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'El nombre del plan es obligatorio.' });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO planes (nombre, precio, analisis, historial_max, platos_max, semanas_max, generaciones_max, dias_vigencia, incluye_planificador, es_default, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        String(nombre).trim(),
        parseFloat(precio) || 0,
        parseLimite(analisis),
        parseLimite(historial_max),
        parseLimite(platos_max),
        parseLimite(semanas_max),
        parseLimite(generaciones_max),
        parseDias(dias_vigencia),
        incluye_planificador ? 1 : 0,
        activo === false ? 0 : 1
      );
    res.status(201).json({ plan: db.prepare('SELECT * FROM planes WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un plan con ese nombre.' });
    res.status(500).json({ error: 'No se pudo crear el plan.' });
  }
});

router.patch('/planes/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM planes WHERE id = ?').get(Number(req.params.id));
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado.' });

  const { nombre, precio, analisis, historial_max, platos_max, semanas_max, generaciones_max, dias_vigencia, incluye_planificador, activo } = req.body || {};
  try {
    db.prepare(
      `UPDATE planes SET
         nombre = ?, precio = ?, analisis = ?, historial_max = ?, platos_max = ?, semanas_max = ?, generaciones_max = ?, dias_vigencia = ?, incluye_planificador = ?, activo = ?
       WHERE id = ?`
    ).run(
      nombre !== undefined ? String(nombre).trim() : plan.nombre,
      precio !== undefined ? parseFloat(precio) || 0 : plan.precio,
      analisis !== undefined ? parseLimite(analisis) : plan.analisis,
      historial_max !== undefined ? parseLimite(historial_max) : plan.historial_max,
      platos_max !== undefined ? parseLimite(platos_max) : plan.platos_max,
      semanas_max !== undefined ? parseLimite(semanas_max) : plan.semanas_max,
      generaciones_max !== undefined ? parseLimite(generaciones_max) : plan.generaciones_max,
      dias_vigencia !== undefined ? parseDias(dias_vigencia) : plan.dias_vigencia,
      incluye_planificador !== undefined ? (incluye_planificador ? 1 : 0) : plan.incluye_planificador,
      activo !== undefined ? (activo ? 1 : 0) : plan.activo,
      plan.id
    );
    res.json({ plan: db.prepare('SELECT * FROM planes WHERE id = ?').get(plan.id) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un plan con ese nombre.' });
    res.status(500).json({ error: 'No se pudo actualizar el plan.' });
  }
});

router.delete('/planes/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM planes WHERE id = ?').get(Number(req.params.id));
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado.' });
  if (plan.es_default) return res.status(400).json({ error: 'No puedes eliminar el plan por defecto.' });

  const enUso = db.prepare('SELECT COUNT(*) c FROM usuarios WHERE plan_id = ?').get(plan.id).c;
  if (enUso > 0) {
    // Hay usuarios en este plan: lo desactivamos en vez de borrarlo (para no perder integridad).
    db.prepare('UPDATE planes SET activo = 0 WHERE id = ?').run(plan.id);
    return res.json({ mensaje: 'El plan tiene usuarios asignados; se desactivo en lugar de eliminarse.' });
  }
  db.prepare('DELETE FROM planes WHERE id = ?').run(plan.id);
  res.json({ mensaje: 'Plan eliminado.' });
});

// ===== PAGOS =====
// Lista de pagos con filtros opcionales: estado, rango de fechas (desde/hasta).
// Las fechas se interpretan en hora local de Peru (UTC-5) para el historico.
router.get('/pagos', (req, res) => {
  const { estado = 'pendiente', desde, hasta } = req.query;
  const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const base = `
    SELECT p.id, p.numero_operacion, p.comprobante_path, p.monto, p.estado, p.creado_en, p.revisado_en,
           strftime('%Y-%m-%d %H:%M', p.creado_en, '-5 hours')  AS creado_local,
           strftime('%Y-%m-%d %H:%M', p.revisado_en, '-5 hours') AS revisado_local,
           u.id AS usuario_id, u.nombre, u.email, pl.nombre AS plan_nombre
    FROM pagos p
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN planes pl ON pl.id = p.plan_id`;

  const cond = [];
  const args = [];
  if (estado && estado !== 'todos') { cond.push('p.estado = ?'); args.push(estado); }
  if (FECHA_RE.test(desde)) { cond.push("date(p.creado_en, '-5 hours') >= date(?)"); args.push(desde); }
  if (FECHA_RE.test(hasta)) { cond.push("date(p.creado_en, '-5 hours') <= date(?)"); args.push(hasta); }

  const where = cond.length ? ` WHERE ${cond.join(' AND ')}` : '';
  const filas = db.prepare(`${base}${where} ORDER BY p.id DESC`).all(...args);
  res.json({ pagos: filas });
});

// Aprobar un pago: asigna al usuario el plan comprado y sus analisis.
const aprobarPago = db.transaction((pagoId) => {
  const pago = db.prepare('SELECT * FROM pagos WHERE id = ?').get(pagoId);
  if (!pago) throw new Error('Pago no encontrado');
  if (pago.estado !== 'pendiente') throw new Error('El pago ya fue procesado');

  const plan = db.prepare('SELECT * FROM planes WHERE id = ?').get(pago.plan_id);
  if (!plan) throw new Error('El plan del pago ya no existe');

  db.prepare("UPDATE pagos SET estado = 'aprobado', revisado_en = datetime('now') WHERE id = ?").run(pagoId);
  const analisis = plan.analisis === null ? 0 : plan.analisis;

  // Vencimiento: +30 dias. Si renueva antes de vencer, extiende desde la fecha actual de vencimiento.
  let expira = null;
  if (plan.precio > 0) {
    const u = db.prepare('SELECT plan_expira FROM usuarios WHERE id = ?').get(pago.usuario_id);
    const hoy = fechaPeru();
    const base = u && u.plan_expira && u.plan_expira > hoy ? u.plan_expira : hoy;
    expira = sumarDias(base, plan.dias_vigencia > 0 ? plan.dias_vigencia : DIAS_VIGENCIA);
  }
  db.prepare('UPDATE usuarios SET plan_id = ?, analisis_restantes = ?, plan_expira = ? WHERE id = ?')
    .run(plan.id, analisis, expira, pago.usuario_id);
  return { usuarioId: pago.usuario_id, plan: plan.nombre, expira };
});

router.post('/pagos/:id/aprobar', (req, res) => {
  try {
    const r = aprobarPago(Number(req.params.id));
    res.json({ mensaje: `Pago aprobado. El usuario ahora tiene el plan ${r.plan}.`, ...r });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/pagos/:id/rechazar', (req, res) => {
  const pago = db.prepare('SELECT * FROM pagos WHERE id = ?').get(Number(req.params.id));
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
  if (pago.estado !== 'pendiente') return res.status(400).json({ error: 'El pago ya fue procesado' });
  db.prepare("UPDATE pagos SET estado = 'rechazado', revisado_en = datetime('now') WHERE id = ?").run(pago.id);
  res.json({ mensaje: 'Pago rechazado.' });
});

// ===== USUARIOS =====
router.get('/usuarios', (req, res) => {
  const usuarios = db
    .prepare(
      `SELECT u.id, u.nombre, u.email, u.rol, u.analisis_restantes, u.creado_en,
              u.plan_id, p.nombre AS plan_nombre, p.analisis AS plan_analisis
       FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
       ORDER BY u.id DESC`
    )
    .all();
  res.json({ usuarios });
});

// PATCH /api/admin/usuarios/:id  { plan_id?, analisis_restantes? }
router.patch('/usuarios/:id', (req, res) => {
  const { plan_id, analisis_restantes } = req.body || {};
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(req.params.id));
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  let nuevoPlanId = usuario.plan_id;
  let analisis = analisis_restantes;

  if (plan_id !== undefined && plan_id !== null) {
    const plan = db.prepare('SELECT * FROM planes WHERE id = ?').get(Number(plan_id));
    if (!plan) return res.status(400).json({ error: 'Plan no encontrado.' });
    nuevoPlanId = plan.id;
    // Al cambiar de plan, reiniciamos los analisis segun el nuevo plan (si tiene limite).
    if (analisis === undefined) analisis = plan.analisis === null ? 0 : plan.analisis;
  }

  db.prepare(
    `UPDATE usuarios SET plan_id = ?, analisis_restantes = COALESCE(?, analisis_restantes) WHERE id = ?`
  ).run(nuevoPlanId, analisis ?? null, usuario.id);

  const { usuarioPublico } = require('../db');
  res.json({ usuario: usuarioPublico(usuario.id) });
});

// ===== CATALOGO DE INGREDIENTES (base para abastecer la despensa) =====
const normCat = (v) => (CATEGORIAS_ING.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : 'otro');

router.get('/catalogo', (req, res) => {
  const ingredientes = db.prepare('SELECT * FROM ingredientes_catalogo ORDER BY categoria, nombre').all();
  res.json({ ingredientes, categorias: CATEGORIAS_ING });
});

router.post('/catalogo', (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del ingrediente es obligatorio.' });
  const info = db.prepare('INSERT INTO ingredientes_catalogo (nombre, categoria, activo) VALUES (?, ?, 1)')
    .run(nombre.slice(0, 80), normCat(req.body?.categoria));
  res.status(201).json({ ingrediente: db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/catalogo/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Ingrediente no encontrado.' });
  const b = req.body || {};
  db.prepare('UPDATE ingredientes_catalogo SET nombre = ?, categoria = ?, activo = ? WHERE id = ?').run(
    b.nombre !== undefined ? (String(b.nombre).trim() || p.nombre).slice(0, 80) : p.nombre,
    b.categoria !== undefined ? normCat(b.categoria) : p.categoria,
    b.activo !== undefined ? (b.activo ? 1 : 0) : p.activo,
    p.id
  );
  res.json({ ingrediente: db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ?').get(p.id) });
});

router.delete('/catalogo/:id', (req, res) => {
  const p = db.prepare('SELECT id FROM ingredientes_catalogo WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Ingrediente no encontrado.' });
  db.prepare('DELETE FROM ingredientes_catalogo WHERE id = ?').run(p.id);
  res.json({ mensaje: 'Ingrediente eliminado del catalogo.' });
});

// ===== SOPORTE (mensajes de los usuarios) =====
router.get('/soporte', (req, res) => {
  const mensajes = db.prepare(
    `SELECT id, usuario_id, nombre, email, celular, whatsapp, asunto, mensaje, estado,
            strftime('%Y-%m-%d %H:%M', creado_en, '-5 hours') AS creado_local
     FROM soporte ORDER BY (estado = 'leido'), id DESC`
  ).all();
  const nuevos = db.prepare("SELECT COUNT(*) c FROM soporte WHERE estado = 'nuevo'").get().c;
  res.json({ mensajes, nuevos });
});

router.patch('/soporte/:id', (req, res) => {
  const m = db.prepare('SELECT id FROM soporte WHERE id = ?').get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Mensaje no encontrado.' });
  const estado = req.body?.estado === 'nuevo' ? 'nuevo' : 'leido';
  db.prepare('UPDATE soporte SET estado = ? WHERE id = ?').run(estado, m.id);
  res.json({ mensaje: 'Actualizado.' });
});

router.delete('/soporte/:id', (req, res) => {
  db.prepare('DELETE FROM soporte WHERE id = ?').run(Number(req.params.id));
  res.json({ mensaje: 'Mensaje eliminado.' });
});

// ===== CONFIGURACION (datos del negocio Yape) =====
router.get('/config', (req, res) => res.json({ config: getAllConfig() }));

router.put('/config', (req, res) => {
  const permitidas = ['yape_numero', 'yape_titular'];
  const cambios = req.body || {};
  for (const clave of permitidas) {
    if (cambios[clave] !== undefined && cambios[clave] !== null && cambios[clave] !== '') {
      setConfig(clave, cambios[clave]);
    }
  }
  // Motor de IA (validado)
  if (['gemini', 'claude', 'ambos'].includes(String(cambios.ai_modo))) setConfig('ai_modo', cambios.ai_modo);
  if (['gemini', 'claude'].includes(String(cambios.ai_prioridad))) setConfig('ai_prioridad', cambios.ai_prioridad);
  // Credito recargado por proveedor (USD)
  for (const k of ['credito_gemini', 'credito_claude']) {
    if (cambios[k] !== undefined && cambios[k] !== null && cambios[k] !== '') {
      const n = parseFloat(cambios[k]);
      if (!Number.isNaN(n) && n >= 0) setConfig(k, String(n));
    }
  }

  res.json({ mensaje: 'Configuracion actualizada.', config: getAllConfig() });
});

// Subir / reemplazar el QR de Yape
router.post('/yape-qr', uploadQr.single('qr'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sube una imagen del QR.' });
  borrarQrAnterior();
  const ruta = `/uploads/${req.file.filename}`;
  setConfig('yape_qr_path', ruta);
  res.json({ mensaje: 'QR actualizado.', yape_qr: ruta });
});

// Quitar el QR de Yape
router.delete('/yape-qr', (req, res) => {
  borrarQrAnterior();
  setConfig('yape_qr_path', '');
  res.json({ mensaje: 'QR eliminado.' });
});

// Manejo de errores de multer (tamano/formato)
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
