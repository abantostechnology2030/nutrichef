// Servidor principal de NutriChefIA.
// Un solo proceso Express sirve la API (/api/*) Y el frontend estatico (public/).
require('dotenv').config();
const express = require('express');
const path = require('path');

require('./db'); // inicializa el esquema y la config por defecto

const app = express();
const PORT = process.env.PORT || 3002;

// ===== Middlewares globales =====
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ===== Archivos estaticos =====
// Comprobantes de Yape subidos (solo el admin los enlaza desde su panel).
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
// Imagenes con cache largo (se versiona el nombre al cambiarlas, ej. logo-v2.png).
app.use('/img', express.static(path.join(__dirname, '..', 'public', 'img'), { maxAge: '30d', immutable: true }));
// Frontend (HTML/CSS/JS plano, sin build step).
app.use(express.static(path.join(__dirname, '..', 'public')));

// ===== API =====
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/analisis', require('./routes/analisis.routes')); // escaner de productos
app.use('/api/hogar', require('./routes/hogar.routes'));       // familia, condiciones, region
app.use('/api/despensa', require('./routes/despensa.routes')); // inventario + compra semanal
app.use('/api/plan', require('./routes/plan.routes'));         // calendario 7x3 + generacion IA
app.use('/api/platos', require('./routes/platos.routes'));     // biblioteca del usuario (guardado = 1)
app.use('/api/pagos', require('./routes/pagos.routes'));
app.use('/api/soporte', require('./routes/soporte.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
// Pendiente (fase 5): /api/plan/faltantes

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'NutriChefIA', fecha: new Date().toISOString() }));

// ===== Arranque =====
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
if (PROVIDER !== 'claude' && !process.env.GEMINI_API_KEY) {
  console.warn('\x1b[33m[AVISO] Falta GEMINI_API_KEY en .env: las llamadas a IA fallaran.\x1b[0m');
}
if (PROVIDER !== 'gemini' && !process.env.ANTHROPIC_API_KEY) {
  console.warn('\x1b[33m[AVISO] Falta ANTHROPIC_API_KEY en .env: las llamadas a IA fallaran.\x1b[0m');
}

app.listen(PORT, () => {
  console.log('\x1b[36m================================\x1b[0m');
  console.log(`  NutriChefIA en http://localhost:${PORT}`);
  console.log('\x1b[36m================================\x1b[0m');
});
