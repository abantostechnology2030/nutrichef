// Rutas de pagos Yape (validacion manual estilo Hotmart checkout).
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, getConfig } = require('../db');
const { requiereAuth } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `comprobante_${req.usuario.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('El comprobante debe ser una imagen JPG, PNG o WEBP.'));
  },
});

// GET /api/pagos/info -> datos del paywall (yape + planes de pago) y estado del pago del usuario
router.get('/info', requiereAuth, (req, res) => {
  const planes = db
    .prepare('SELECT id, nombre, precio, analisis, historial_max, platos_max, semanas_max, generaciones_max, incluye_planificador FROM planes WHERE activo = 1 AND precio > 0 ORDER BY precio')
    .all();

  const pendiente = db
    .prepare(
      `SELECT p.id, p.numero_operacion, p.monto, p.estado, p.creado_en, pl.nombre AS plan_nombre
       FROM pagos p LEFT JOIN planes pl ON pl.id = p.plan_id
       WHERE p.usuario_id = ? AND p.estado = 'pendiente' ORDER BY p.id DESC LIMIT 1`
    )
    .get(req.usuario.id);

  res.json({
    yape_numero: getConfig('yape_numero'),
    yape_titular: getConfig('yape_titular'),
    yape_qr: getConfig('yape_qr_path') || null,
    plan_actual: req.usuario.plan_nombre,
    ilimitado: req.usuario.ilimitado,
    analisis_restantes: req.usuario.analisis_restantes,
    plan_expira: req.usuario.plan_expira,
    dias_restantes: req.usuario.dias_restantes,
    planes,
    pago_pendiente: pendiente || null,
  });
});

// GET /api/pagos/historial -> historial de pagos del propio usuario (todos los estados)
router.get('/historial', requiereAuth, (req, res) => {
  const pagos = db
    .prepare(
      `SELECT p.id, p.numero_operacion, p.monto, p.estado, p.creado_en, p.revisado_en,
              strftime('%Y-%m-%d %H:%M', p.creado_en, '-5 hours')  AS creado_local,
              strftime('%Y-%m-%d %H:%M', p.revisado_en, '-5 hours') AS revisado_local,
              pl.nombre AS plan_nombre
       FROM pagos p LEFT JOIN planes pl ON pl.id = p.plan_id
       WHERE p.usuario_id = ? ORDER BY p.id DESC`
    )
    .all(req.usuario.id);
  res.json({ pagos });
});

// POST /api/pagos  (multipart: "comprobante" + numero_operacion + plan_id)
router.post('/', requiereAuth, upload.single('comprobante'), (req, res) => {
  const numero = (req.body?.numero_operacion || '').trim();
  const planId = parseInt(req.body?.plan_id, 10);

  const limpiar = () => req.file && fs.unlink(req.file.path, () => {});

  if (!numero) { limpiar(); return res.status(400).json({ error: 'Ingresa el numero de operacion del Yape.' }); }
  if (!req.file) { return res.status(400).json({ error: 'Sube la captura del comprobante de Yape.' }); }

  const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1 AND precio > 0').get(planId);
  if (!plan) { limpiar(); return res.status(400).json({ error: 'Selecciona un plan valido.' }); }

  const yaPendiente = db.prepare("SELECT id FROM pagos WHERE usuario_id = ? AND estado = 'pendiente'").get(req.usuario.id);
  if (yaPendiente) {
    limpiar();
    return res.status(409).json({ error: 'Ya tienes un pago en revision. Espera la aprobacion del administrador.' });
  }

  const rutaRelativa = `/uploads/${req.file.filename}`;
  try {
    const info = db
      .prepare(
        `INSERT INTO pagos (usuario_id, plan_id, numero_operacion, comprobante_path, monto, estado)
         VALUES (?, ?, ?, ?, ?, 'pendiente')`
      )
      .run(req.usuario.id, plan.id, numero, rutaRelativa, plan.precio);

    res.status(201).json({
      mensaje: `Comprobante recibido. Activaremos el plan ${plan.nombre} al aprobar tu pago.`,
      pago_id: info.lastInsertRowid,
    });
  } catch (e) {
    limpiar();
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ese numero de operacion ya fue registrado.' });
    }
    console.error('Error al registrar pago:', e.message);
    res.status(500).json({ error: 'No pudimos registrar tu pago. Intenta nuevamente.' });
  }
});

router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
