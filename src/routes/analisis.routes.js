// Rutas del ESCANER de productos: analiza un alimento por nombre o por fotos.
// Cache-first por nombre: si ya esta en el historial del usuario, no se llama a la IA
// ni se descuenta un analisis.
const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { candadoFreemium, descontarAnalisis } = require('../middleware/freemium');
const { explicarPorTexto, explicarPorImagen } = require('../services/ai.service');

const router = express.Router();

// Imagenes en memoria (se mandan a la IA en base64, no se guardan en disco).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Formato de imagen no soportado (usa JPG, PNG, WEBP o GIF).'));
  },
});

// Busca un producto en el historial guardado del usuario (cache-first, solo por texto).
function buscarEnHistorial(usuarioId, producto) {
  const fila = db
    .prepare('SELECT respuesta_json FROM analisis WHERE usuario_id = ? AND LOWER(TRIM(consulta)) = LOWER(TRIM(?)) ORDER BY id DESC LIMIT 1')
    .get(usuarioId, producto);
  return fila ? JSON.parse(fila.respuesta_json) : null;
}

// Guarda el analisis respetando el limite del plan (historial_max):
//   null -> ilimitado ; 0 -> no guarda ; N -> conserva los ultimos N (ventana rodante).
// No guarda resultados con error. dedup=true reemplaza una entrada previa del mismo producto.
function guardarHistorial(usuario, consulta, resultado, usage = {}, dedup = false) {
  const max = usuario.historial_max; // resuelto en usuarioPublico (admin -> null)
  if (max === 0) return;
  if (resultado && resultado.error) return; // no cachear "no es un alimento"

  if (dedup) {
    db.prepare('DELETE FROM analisis WHERE usuario_id = ? AND LOWER(TRIM(consulta)) = LOWER(TRIM(?))').run(usuario.id, consulta);
  }
  db.prepare(
    'INSERT INTO analisis (usuario_id, consulta, respuesta_json, input_tokens, output_tokens, proveedor) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(usuario.id, consulta, JSON.stringify(resultado), usage.input || 0, usage.output || 0, usage.proveedor || null);

  // Ventana rodante: borra los mas antiguos que excedan el limite.
  if (max != null) {
    const sobrantes = db
      .prepare('SELECT id FROM analisis WHERE usuario_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?')
      .all(usuario.id, max)
      .map((r) => r.id);
    if (sobrantes.length) {
      db.prepare(`DELETE FROM analisis WHERE id IN (${sobrantes.map(() => '?').join(',')})`).run(...sobrantes);
    }
  }
}

// POST /api/analisis/texto  { producto: "Galletas Soda" }
router.post('/texto', requiereAuth, async (req, res) => {
  const producto = (req.body?.producto || '').trim();
  if (!producto) return res.status(400).json({ error: 'Escribe el nombre del producto.' });
  const usuario = req.usuario;

  // 1) Cache: buscar en el historial guardado.
  const cacheado = buscarEnHistorial(usuario.id, producto);
  if (cacheado) {
    return res.json({ resultado: cacheado, cacheado: true, analisis_restantes: usuario.analisis_restantes, ilimitado: usuario.ilimitado });
  }

  // 2) Cache-miss: aplicar el candado freemium.
  if (!usuario.ilimitado && usuario.analisis_restantes <= 0) {
    return res.status(402).json({ error: 'Has agotado tus analisis gratuitos.', paywall: true, redirect: '/mi-plan.html' });
  }

  // 3) IA -> descontar (solo si respondio bien) -> guardar en historial.
  try {
    const { resultado, usage } = await explicarPorTexto(producto);
    const restantes = descontarAnalisis(usuario);
    guardarHistorial(usuario, producto, resultado, usage, true);
    res.json({ resultado, usage, cacheado: false, analisis_restantes: restantes, ilimitado: usuario.ilimitado });
  } catch (e) {
    console.error('Error IA (texto):', e.message);
    res.status(502).json({ error: 'No pudimos procesar el producto. Intenta nuevamente.' });
  }
});

// POST /api/analisis/imagen (multipart: "ingredientes" obligatoria, "nombre" opcional).
// Siempre va a la IA (no hay cache por foto).
const camposFotos = upload.fields([{ name: 'ingredientes', maxCount: 1 }, { name: 'nombre', maxCount: 1 }]);
router.post('/imagen', requiereAuth, candadoFreemium, camposFotos, async (req, res) => {
  const fIng = req.files?.ingredientes?.[0];
  const fNom = req.files?.nombre?.[0];
  if (!fIng) return res.status(400).json({ error: 'Sube la foto de los ingredientes del producto.' });

  try {
    // La foto del nombre va primera (si existe) y luego la de ingredientes.
    const imagenes = [];
    if (fNom) imagenes.push({ base64: fNom.buffer.toString('base64'), mediaType: fNom.mimetype, tipo: 'nombre' });
    imagenes.push({ base64: fIng.buffer.toString('base64'), mediaType: fIng.mimetype, tipo: 'ingredientes' });

    const { resultado, usage } = await explicarPorImagen(imagenes);
    const restantes = req.consumirAnalisis();
    const nombre = resultado && resultado.nombre ? String(resultado.nombre).trim() : '';
    guardarHistorial(req.usuario, nombre || '[Producto escaneado]', resultado, usage, !!nombre);
    res.json({ resultado, usage, analisis_restantes: restantes, ilimitado: req.usuario.ilimitado });
  } catch (e) {
    console.error('Error IA (imagen):', e.message);
    res.status(502).json({ error: 'No pudimos leer la imagen. Asegurate de que los ingredientes se vean claros.' });
  }
});

// GET /api/analisis/historial?desde=&hasta=  (filtro de fecha opcional, hora Peru UTC-5)
router.get('/historial', requiereAuth, (req, res) => {
  const { desde, hasta } = req.query;
  const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const cond = ['usuario_id = ?'];
  const args = [req.usuario.id];
  if (FECHA_RE.test(desde)) { cond.push("date(creado_en, '-5 hours') >= date(?)"); args.push(desde); }
  if (FECHA_RE.test(hasta)) { cond.push("date(creado_en, '-5 hours') <= date(?)"); args.push(hasta); }

  const filas = db
    .prepare(`SELECT id, consulta, respuesta_json, input_tokens, output_tokens, creado_en FROM analisis WHERE ${cond.join(' AND ')} ORDER BY id DESC`)
    .all(...args);
  res.json({
    historial: filas.map((f) => ({
      id: f.id,
      consulta: f.consulta,
      resultado: JSON.parse(f.respuesta_json),
      input_tokens: f.input_tokens,
      output_tokens: f.output_tokens,
      creado_en: f.creado_en,
    })),
    historial_max: req.usuario.historial_max, // null=ilimitado, 0=no guarda, N
  });
});

// DELETE /api/analisis/:id -> borra un producto guardado del historial
router.delete('/:id', requiereAuth, (req, res) => {
  const fila = db.prepare('SELECT id FROM analisis WHERE id = ? AND usuario_id = ?').get(Number(req.params.id), req.usuario.id);
  if (!fila) return res.status(404).json({ error: 'Producto no encontrado en tu historial.' });
  db.prepare('DELETE FROM analisis WHERE id = ?').run(fila.id);
  res.json({ mensaje: 'Eliminado del historial.' });
});

// Manejo de errores de multer (tamano/formato)
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
