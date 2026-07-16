// Crea la cuenta de administrador inicial. Ejecutar con: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, planPremium } = require('./db');

const email = (process.env.ADMIN_EMAIL || 'admin@nutrichefia.pe').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'admin123';
const nombre = process.env.ADMIN_NOMBRE || 'Administrador';

const existente = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);

if (existente) {
  console.log(`El admin "${email}" ya existe (id ${existente.id}). No se crea de nuevo.`);
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 10);
const premiumId = planPremium() ? planPremium().id : null;
const info = db
  .prepare(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, plan_id, analisis_restantes)
     VALUES (?, ?, ?, 'admin', ?, 999999)`
  )
  .run(nombre, email, hash, premiumId);

console.log('==============================================');
console.log(' Administrador creado correctamente');
console.log(` Email:    ${email}`);
console.log(` Password: ${password}`);
console.log(` ID:       ${info.lastInsertRowid}`);
console.log('==============================================');
console.log(' Cambia la contrasena despues del primer login.');
process.exit(0);
