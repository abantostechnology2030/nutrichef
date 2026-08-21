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

// PATCH /api/auth/perfil { nombre?, email?, foto? }
//
// La foto viaja como DATA URL ya comprimida por el navegador (256px, JPEG). Se valida el
// prefijo y el tamano: sin tope, cualquiera podria meter varios MB de base64 en una fila y
// engordar la BD (que ademas se respalda entera en cada despliegue).
router.patch('/perfil', requiereAuth, (req, res) => {
  const actual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim().slice(0, 80) : actual.nombre;
  if (!nombre) return res.status(400).json({ error: 'El nombre no puede estar vacio.' });

  let email = actual.email;
  if (req.body?.email !== undefined) {
    email = String(req.body.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'El email no tiene un formato valido.' });
    // El email es UNIQUE en el esquema: se comprueba antes para devolver 409 con un mensaje
    // util en vez de dejar que salte la restriccion como error 500.
    if (db.prepare('SELECT id FROM usuarios WHERE email = ? AND id <> ?').get(email, actual.id)) {
      return res.status(409).json({ error: 'Ese email ya esta en uso por otra cuenta.' });
    }
  }

  let foto = actual.foto;
  if (req.body?.foto !== undefined) {
    const f = req.body.foto;
    if (f === null || f === '') foto = null;
    else if (typeof f === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(f) && f.length <= 400000) foto = f;
    else return res.status(400).json({ error: 'La foto no es valida o es demasiado grande.' });
  }

  db.prepare('UPDATE usuarios SET nombre = ?, email = ?, foto = ? WHERE id = ?').run(nombre, email, foto, actual.id);
  res.json({ usuario: usuarioPublico(actual.id) });
});

// POST /api/auth/password { actual, nueva }
// Exige la contrasena ACTUAL aunque la sesion ya este iniciada: si alguien deja el navegador
// abierto, no deberia poder cambiarla y dejar fuera al dueno de la cuenta.
router.post('/password', requiereAuth, (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!actual || !nueva) return res.status(400).json({ error: 'Escribe tu contrasena actual y la nueva.' });
  if (String(nueva).length < 6) return res.status(400).json({ error: 'La nueva contrasena debe tener al menos 6 caracteres.' });
  const fila = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!fila || !bcrypt.compareSync(String(actual), fila.password_hash)) {
    return res.status(401).json({ error: 'La contrasena actual no es correcta.' });
  }
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(nueva), 10), req.usuario.id);
  res.json({ mensaje: 'Contrasena actualizada.' });
});

module.exports = router;
