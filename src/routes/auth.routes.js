// Rutas de autenticacion: registro y login
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, usuarioPublico, planDefault } = require('../db');
const { firmarToken, requiereAuth } = require('../middleware/auth');

const router = express.Router();

const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// POST /api/auth/registro
router.post('/registro', (req, res) => {
  const { nombre, email, password } = req.body || {};

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contrasena son obligatorios.' });
  }
  if (!emailValido(email)) {
    return res.status(400).json({ error: 'El email no tiene un formato valido.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 6 caracteres.' });
  }

  const yaExiste = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email.toLowerCase());
  if (yaExiste) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
  }

  const plan = planDefault();
  const analisisIniciales = plan && plan.analisis !== null ? plan.analisis : 0;
  const hash = bcrypt.hashSync(password, 10);

  const info = db
    .prepare(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, plan_id, analisis_restantes)
       VALUES (?, ?, ?, 'user', ?, ?)`
    )
    .run(nombre.trim(), email.toLowerCase(), hash, plan ? plan.id : null, analisisIniciales);

  const usuario = usuarioPublico(info.lastInsertRowid);
  const token = firmarToken(usuario);
  res.status(201).json({ token, usuario });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contrasena son obligatorios.' });
  }

  const fila = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(String(email).toLowerCase());
  if (!fila || !bcrypt.compareSync(password, fila.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas.' });
  }

  const usuario = usuarioPublico(fila.id);
  const token = firmarToken(usuario);
  res.json({ token, usuario });
});

// GET /api/auth/yo  -> datos frescos del usuario autenticado (plan/analisis/hogar)
router.get('/yo', requiereAuth, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
