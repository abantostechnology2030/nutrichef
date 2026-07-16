// Middleware de autenticacion y autorizacion por roles
const jwt = require('jsonwebtoken');
const { usuarioPublico } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_inseguro';

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Exige un token valido. Adjunta el usuario fresco de la BD a req.usuario
function requiereAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesion.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const usuario = usuarioPublico(payload.id);

    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    req.usuario = usuario;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesion invalida o expirada.' });
  }
}

// Exige rol admin (usar despues de requiereAuth)
function requiereAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores.' });
  }
  next();
}

module.exports = { firmarToken, requiereAuth, requiereAdmin, JWT_SECRET };
