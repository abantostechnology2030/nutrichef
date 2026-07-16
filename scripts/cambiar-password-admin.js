// Cambia la contrasena de una cuenta (por defecto, la del admin).
// Uso:
//   node scripts/cambiar-password-admin.js "NuevaClaveSegura"
//   node scripts/cambiar-password-admin.js "NuevaClaveSegura" otro@correo.pe
//
// Corre igual en local y en produccion (usa la misma BD que el server).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const nuevaPassword = process.argv[2];
const email = (process.argv[3] || process.env.ADMIN_EMAIL || 'admin@nutrichefia.pe').toLowerCase();

if (!nuevaPassword || nuevaPassword.length < 6) {
  console.error('Falta la nueva contrasena (minimo 6 caracteres).');
  console.error('Uso: node scripts/cambiar-password-admin.js "NuevaClave" [email]');
  process.exit(1);
}

const usuario = db.prepare('SELECT id, email, rol FROM usuarios WHERE email = ?').get(email);
if (!usuario) {
  console.error(`No existe ningun usuario con el correo "${email}".`);
  process.exit(1);
}

const hash = bcrypt.hashSync(nuevaPassword, 10);
db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, usuario.id);

console.log('==============================================');
console.log(' Contrasena actualizada');
console.log(` Email: ${usuario.email} (rol ${usuario.rol})`);
console.log('==============================================');
process.exit(0);
