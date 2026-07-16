// Soporte: el usuario envia mensajes de contacto; el admin los recibe (con aviso).
const express = require('express');
const { db } = require('../db');
const { requiereAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requiereAuth);

// POST /api/soporte { asunto?, mensaje, email?, celular?, whatsapp? }
router.post('/', (req, res) => {
  const asunto = String(req.body?.asunto || '').trim().slice(0, 120) || null;
  const mensaje = String(req.body?.mensaje || '').trim().slice(0, 2000);
  if (!mensaje) return res.status(400).json({ error: 'Escribe tu mensaje.' });
  const email = String(req.body?.email || '').trim().slice(0, 120) || req.usuario.email;
  const celular = String(req.body?.celular || '').trim().slice(0, 30) || null;
  const whatsapp = req.body?.whatsapp ? 1 : 0;

  const info = db
    .prepare('INSERT INTO soporte (usuario_id, nombre, email, celular, whatsapp, asunto, mensaje) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.usuario.id, req.usuario.nombre, email, celular, whatsapp, asunto, mensaje);
  res.status(201).json({ id: info.lastInsertRowid, mensaje: 'Mensaje enviado. Te responderemos pronto.' });
});

// GET /api/soporte/mios -> mensajes propios del usuario
router.get('/mios', (req, res) => {
  const mensajes = db
    .prepare("SELECT id, asunto, mensaje, estado, strftime('%Y-%m-%d %H:%M', creado_en, '-5 hours') AS creado_local FROM soporte WHERE usuario_id = ? ORDER BY id DESC")
    .all(req.usuario.id);
  res.json({ mensajes });
});

module.exports = router;
