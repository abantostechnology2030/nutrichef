// Capa de acceso a datos: SQLite (un unico archivo local nutrichefia.db).
// Esquema limpio y completo desde el dia 1: la BD nace vacia, asi que NO hay
// migraciones de compatibilidad. Si cambias el esquema, agrega la migracion aqui.
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'nutrichefia.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===== PLANES (catalogo administrado por el admin) =====
// NULL en un limite = ILIMITADO. Gates del negocio:
//   analisis        -> escaneos de producto incluidos
//   historial_max   -> productos guardados en el historial (0 = no guarda)
//   platos_max      -> platos guardados en la biblioteca
//   semanas_max     -> semanas distintas programables en el calendario
//   generaciones_max-> llamadas IA del planificador por SEMANA (el cuello de costo)
//   incluye_planificador -> habilita hogar + despensa + plan de comidas
db.exec(`
  CREATE TABLE IF NOT EXISTS planes (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre               TEXT    NOT NULL UNIQUE,
    precio               REAL    NOT NULL DEFAULT 0,
    analisis             INTEGER,
    historial_max        INTEGER,
    platos_max           INTEGER,
    semanas_max          INTEGER,
    generaciones_max     INTEGER,
    dias_vigencia        INTEGER NOT NULL DEFAULT 30,
    incluye_planificador INTEGER NOT NULL DEFAULT 0,
    es_default           INTEGER NOT NULL DEFAULT 0,
    activo               INTEGER NOT NULL DEFAULT 1,
    creado_en            TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Planes por defecto (idempotente: nombre es UNIQUE).
//
// GENERACIONES_MAX DEL FREE = 7 (una por dia). El planificador genera UN DIA a la vez
// (3 platos), no la semana entera: 7 llamadas alcanzan justo para armar la semana
// completa dia a dia. Cuando el menu se generaba de un golpe, 1 sola llamada rendia los
// 21 platos y por eso el Free tenia 1. Con el modelo por dia, dejarlo en 1 significaria
// que un usuario Free arma UN dia y se queda sin cupo.
const analisisFree = parseInt(process.env.ANALISIS_FREE || '3', 10);
const precioPremium = parseFloat(process.env.PRECIO_PREMIUM || '19.90');
db.prepare(
  `INSERT OR IGNORE INTO planes
     (nombre, precio, analisis, historial_max, platos_max, semanas_max, generaciones_max, incluye_planificador, es_default, activo)
   VALUES ('Free', 0, ?, 3, 5, 1, 7, 1, 1, 1)`
).run(analisisFree);
db.prepare(
  `INSERT OR IGNORE INTO planes
     (nombre, precio, analisis, historial_max, platos_max, semanas_max, generaciones_max, incluye_planificador, es_default, activo)
   VALUES ('Premium', ?, NULL, NULL, NULL, NULL, NULL, 1, 0, 1)`
).run(precioPremium);

// Migracion: el Free viejo tenia generaciones_max = 1 (un menu semanal de un golpe).
// El INSERT de arriba es OR IGNORE, asi que en una BD ya creada NO actualiza nada: sin
// este UPDATE, el Free existente se quedaria con 1 y solo podria generar un dia.
// Solo se toca si sigue en el valor viejo exacto: si el admin lo puso en otro numero a
// proposito, esa decision se respeta.
db.prepare("UPDATE planes SET generaciones_max = 7 WHERE nombre = 'Free' AND generaciones_max = 1").run();

const planDefault = () =>
  db.prepare('SELECT * FROM planes WHERE es_default = 1 ORDER BY id LIMIT 1').get() ||
  db.prepare('SELECT * FROM planes ORDER BY id LIMIT 1').get();
const planPremium = () => db.prepare("SELECT * FROM planes WHERE nombre = 'Premium'").get();

// ===== USUARIOS =====
// plan_expira: YYYY-MM-DD de vencimiento del plan de pago (NULL = sin vencimiento).
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre             TEXT    NOT NULL,
    email              TEXT    NOT NULL UNIQUE,
    password_hash      TEXT    NOT NULL,
    rol                TEXT    NOT NULL DEFAULT 'user' CHECK (rol IN ('user','admin')),
    plan_id            INTEGER REFERENCES planes(id),
    analisis_restantes INTEGER NOT NULL DEFAULT 0,
    plan_expira        TEXT,
    creado_en          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ===== PAGOS (Yape, aprobados a mano por el admin) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS pagos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id        INTEGER NOT NULL,
    plan_id           INTEGER REFERENCES planes(id),
    numero_operacion  TEXT    NOT NULL UNIQUE,
    comprobante_path  TEXT    NOT NULL,
    monto             REAL    NOT NULL,
    estado            TEXT    NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
    creado_en         TEXT    NOT NULL DEFAULT (datetime('now')),
    revisado_en       TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);

// ===== ANALISIS (historial del escaner de productos) =====
// consulta = nombre del producto ; respuesta_json = JSON de la IA (semaforo, lo bueno/malo...)
// proveedor = gemini|claude (para el costo por proveedor en el panel admin).
db.exec(`
  CREATE TABLE IF NOT EXISTS analisis (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id     INTEGER NOT NULL,
    consulta       TEXT    NOT NULL,
    respuesta_json TEXT    NOT NULL,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    proveedor      TEXT,
    creado_en      TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);

// ===== HOGAR (configuracion previa: 1 por usuario) =====
// Sin esto la IA no puede proponer nada -> "configurado" es el gate del onboarding.
// region/ciudad alimentan la cocina regional ; dieta y presupuesto son restricciones globales.
db.exec(`
  CREATE TABLE IF NOT EXISTS hogar (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id   INTEGER NOT NULL UNIQUE,
    nombre       TEXT,
    region       TEXT    NOT NULL DEFAULT 'costa' CHECK (region IN ('costa','sierra','selva')),
    ciudad       TEXT,
    dieta        TEXT    NOT NULL DEFAULT 'omnivora' CHECK (dieta IN ('omnivora','vegetariana','vegana','pescetariana')),
    presupuesto  TEXT    NOT NULL DEFAULT 'medio' CHECK (presupuesto IN ('bajo','medio','alto')),
    comensales   INTEGER NOT NULL DEFAULT 1,
    notas        TEXT,
    configurado  INTEGER NOT NULL DEFAULT 0,
    creado_en    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);

// ===== INTEGRANTES (miembros de la familia) =====
// condiciones: JSON ["diabetes","hipertension",...] -> la IA adapta el plato.
// alergias:    JSON ["mani","lacteos",...]         -> EXCLUSION DURA, nunca se sugiere.
db.exec(`
  CREATE TABLE IF NOT EXISTS integrantes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hogar_id    INTEGER NOT NULL,
    nombre      TEXT    NOT NULL,
    edad        INTEGER,
    condiciones TEXT    NOT NULL DEFAULT '[]',
    alergias    TEXT    NOT NULL DEFAULT '[]',
    notas       TEXT,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hogar_id) REFERENCES hogar(id) ON DELETE CASCADE
  );
`);

// ===== CATALOGO DE INGREDIENTES (administrado por el admin) =====
// Lista base con la que el usuario abastece su despensa mas rapido.
db.exec(`
  CREATE TABLE IF NOT EXISTS ingredientes_catalogo (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre    TEXT    NOT NULL,
    categoria TEXT    NOT NULL DEFAULT 'otro',
    activo    INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ===== COMPRAS (cabecera de la compra semanal; sus items entran a la despensa) =====
// total_items = cuantos ingredientes traia la compra AL REGISTRARLA. Se guarda aqui
// porque los items viven en "despensa", que es inventario MUTABLE: si luego el usuario
// edita o borra un ingrediente, contar por compra_id daria un historial que se reescribe
// solo ("compre 6" pasaria a decir 5). El conteo por compra_id sigue sirviendo, pero
// significa otra cosa: cuantos de esa compra siguen vigentes.
db.exec(`
  CREATE TABLE IF NOT EXISTS compras (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL,
    semana      TEXT    NOT NULL,
    nota        TEXT,
    total_items INTEGER NOT NULL DEFAULT 0,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);
if (!db.prepare('PRAGMA table_info(compras)').all().some((c) => c.name === 'total_items')) {
  db.exec('ALTER TABLE compras ADD COLUMN total_items INTEGER NOT NULL DEFAULT 0');
}

// ===== DESPENSA (inventario simple: sin descuento automatico al cocinar) =====
// nivel = poco|normal|bastante. La IA razona con disponibilidad, no con gramos.
// UNIQUE por usuario+nombre normalizado: un ingrediente = una fila (se actualiza el nivel).
db.exec(`
  CREATE TABLE IF NOT EXISTS despensa (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id    INTEGER NOT NULL,
    nombre        TEXT    NOT NULL,
    categoria     TEXT    NOT NULL DEFAULT 'otro',
    nivel         TEXT    NOT NULL DEFAULT 'normal' CHECK (nivel IN ('poco','normal','bastante')),
    origen        TEXT    NOT NULL DEFAULT 'manual' CHECK (origen IN ('compra','manual')),
    compra_id     INTEGER REFERENCES compras(id) ON DELETE SET NULL,
    actualizado_en TEXT   NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ix_despensa_unica ON despensa (usuario_id, LOWER(TRIM(nombre)));');

// ===== PLATOS (generados por IA, propuestos por el usuario o manuales) =====
// ingredientes: JSON [{ nombre, cantidad, unidad }]
// faltantes:    JSON ["..."] -> ingredientes del plato que NO estaban en la despensa al generarlo
// pasos:        JSON ["...", "..."] | NULL -> se generan en la FASE 2 (al abrir el plato)
// info:         JSON { resumen, aporte_nutricional, advertencias }
// origen:       ia = generado | propuesto = lo pidio el usuario por nombre | manual = lo escribio
//
// guardado: 1 = esta en la BIBLIOTECA del usuario ("Mis platos"), 0 = solo existe porque
// lo genero el planificador. La distincion es necesaria: llenar la semana crea 21 platos
// y el plan Free permite 5, asi que contar TODOS los platos contra platos_max haria
// imposible planificar. El tope aplica a lo que el usuario decide CURAR, no a lo que la
// IA produce para el calendario.
db.exec(`
  CREATE TABLE IF NOT EXISTS platos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id   INTEGER NOT NULL,
    nombre       TEXT    NOT NULL,
    momento      TEXT    CHECK (momento IN ('desayuno','almuerzo','cena')),
    porciones    INTEGER NOT NULL DEFAULT 1,
    ingredientes TEXT    NOT NULL DEFAULT '[]',
    faltantes    TEXT    NOT NULL DEFAULT '[]',
    pasos        TEXT,
    info         TEXT,
    nota         TEXT,
    tiempo_min   INTEGER,
    dificultad   TEXT    CHECK (dificultad IN ('facil','media','dificil')),
    region       TEXT,
    origen       TEXT    NOT NULL DEFAULT 'ia' CHECK (origen IN ('ia','propuesto','manual')),
    guardado     INTEGER NOT NULL DEFAULT 0,
    creado_en    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);
// Columnas agregadas despues del esquema inicial (idempotente).
{
  const cols = db.prepare('PRAGMA table_info(platos)').all();
  if (!cols.some((c) => c.name === 'faltantes')) db.exec("ALTER TABLE platos ADD COLUMN faltantes TEXT NOT NULL DEFAULT '[]'");
  if (!cols.some((c) => c.name === 'nota')) db.exec('ALTER TABLE platos ADD COLUMN nota TEXT');
  if (!cols.some((c) => c.name === 'guardado')) db.exec('ALTER TABLE platos ADD COLUMN guardado INTEGER NOT NULL DEFAULT 0');
}

// ===== PLAN DE COMIDAS (calendario 7 dias x 3 momentos) =====
// semana = fecha (YYYY-MM-DD) del LUNES ; dia = 0..6 (0=Domingo) ; momento = desayuno|almuerzo|cena
// UNIQUE(usuario, semana, dia, momento): una casilla, un plato.
// cobertura: JSON del resultado de verificar el plato contra la despensa. Vive AQUI y no en
// "platos" porque el plato es estable y lo que cambia es la despensa (misma comida, otra semana).
db.exec(`
  CREATE TABLE IF NOT EXISTS plan_comidas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id   INTEGER NOT NULL,
    semana       TEXT    NOT NULL,
    dia          INTEGER NOT NULL CHECK (dia BETWEEN 0 AND 6),
    momento      TEXT    NOT NULL CHECK (momento IN ('desayuno','almuerzo','cena')),
    plato_id     INTEGER NOT NULL,
    comensales   INTEGER,
    cocinado     INTEGER NOT NULL DEFAULT 0,
    cobertura    TEXT,
    verificado_en TEXT,
    creado_en    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (usuario_id, semana, dia, momento),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (plato_id)   REFERENCES platos(id)   ON DELETE CASCADE
  );
`);

// ===== GENERACIONES (log de llamadas IA del planificador) =====
// Cumple DOS funciones: (1) gate del plan -> generaciones_max por semana ;
// (2) costo real en el panel admin. En NutriIA el panel solo contaba los analisis y
// dejaba fuera lo caro; aqui la generacion del planificador SI se contabiliza.
//
// tipo: dia | plato | detalle | verificar (+ "menu" HISTORICO). "menu" era la generacion
// de la semana completa de un golpe, que ya no existe: el planificador genera un dia a la
// vez. No hay CHECK sobre la columna a proposito, asi que las filas viejas con tipo='menu'
// siguen siendo validas y el panel admin las sigue sumando al costo.
db.exec(`
  CREATE TABLE IF NOT EXISTS generaciones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id    INTEGER NOT NULL,
    semana        TEXT    NOT NULL,
    tipo          TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    proveedor     TEXT,
    creado_en     TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
`);

// ===== SOPORTE (mensajes de contacto del usuario al admin) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS soporte (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nombre     TEXT,
    email      TEXT,
    celular    TEXT,
    whatsapp   INTEGER NOT NULL DEFAULT 0,
    asunto     TEXT,
    mensaje    TEXT    NOT NULL,
    estado     TEXT    NOT NULL DEFAULT 'nuevo' CHECK (estado IN ('nuevo','leido')),
    creado_en  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
  );
`);

// ===== CONFIG (clave/valor) =====
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );
`);
function setConfigDefault(clave, valor) {
  db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)').run(clave, String(valor));
}
setConfigDefault('yape_numero', process.env.YAPE_NUMERO || '999888777');
setConfigDefault('yape_titular', process.env.YAPE_TITULAR || 'NutriChefIA Peru');
// Motor de IA (editable desde el admin): modo = gemini|claude|ambos ; prioridad (si ambos).
setConfigDefault('ai_modo', 'ambos');
setConfigDefault('ai_prioridad', 'gemini');
// Credito recargado por proveedor (USD) para estimar el saldo restante y avisar.
setConfigDefault('credito_gemini', '10.67');
setConfigDefault('credito_claude', '7.60');

// ===== Semilla del catalogo de ingredientes (solo si esta vacio) =====
if (db.prepare('SELECT COUNT(*) c FROM ingredientes_catalogo').get().c === 0) {
  const ins = db.prepare('INSERT INTO ingredientes_catalogo (nombre, categoria) VALUES (?, ?)');
  const semilla = [
    ['Arroz', 'abarrote'], ['Fideos', 'abarrote'], ['Aceite vegetal', 'abarrote'], ['Azucar', 'abarrote'],
    ['Sal', 'abarrote'], ['Harina', 'abarrote'], ['Avena', 'abarrote'], ['Quinua', 'abarrote'],
    ['Papa', 'verdura'], ['Camote', 'verdura'], ['Cebolla', 'verdura'], ['Tomate', 'verdura'],
    ['Zanahoria', 'verdura'], ['Ajo', 'verdura'], ['Aji amarillo', 'verdura'], ['Aji panca', 'verdura'],
    ['Choclo', 'verdura'], ['Zapallo', 'verdura'], ['Espinaca', 'verdura'], ['Brocoli', 'verdura'],
    ['Platano', 'fruta'], ['Manzana', 'fruta'], ['Naranja', 'fruta'], ['Palta', 'fruta'],
    ['Limon', 'fruta'], ['Papaya', 'fruta'], ['Mango', 'fruta'],
    ['Pollo', 'carne'], ['Carne de res', 'carne'], ['Carne de cerdo', 'carne'], ['Higado', 'carne'],
    ['Pescado', 'pescado'], ['Atun en conserva', 'pescado'], ['Bonito', 'pescado'],
    ['Leche', 'lacteo'], ['Queso fresco', 'lacteo'], ['Yogurt', 'lacteo'], ['Mantequilla', 'lacteo'],
    ['Huevo', 'huevo'],
    ['Lentejas', 'legumbre'], ['Frejoles', 'legumbre'], ['Garbanzos', 'legumbre'], ['Pallares', 'legumbre'],
    ['Comino', 'condimento'], ['Pimienta', 'condimento'], ['Oregano', 'condimento'], ['Culantro', 'condimento'],
    ['Pan', 'otro'], ['Cafe', 'bebida'], ['Te', 'bebida'], ['Emoliente', 'bebida'],
  ];
  const tx = db.transaction(() => semilla.forEach(([n, c]) => ins.run(n, c)));
  tx();
}

// ===== Helpers de config =====
function getConfig(clave, fallback = null) {
  const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave);
  return row ? row.valor : fallback;
}
function setConfig(clave, valor) {
  db.prepare(
    'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor'
  ).run(clave, String(valor));
}
function getAllConfig() {
  const rows = db.prepare('SELECT clave, valor FROM config').all();
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

// ===== Helpers de fecha (Peru = UTC-5) =====
const fechaPeru = (d = new Date()) => new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
function sumarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasHasta(iso) {
  if (!iso) return null;
  const ms = new Date(iso + 'T00:00:00Z') - new Date(fechaPeru() + 'T00:00:00Z');
  return Math.max(0, Math.round(ms / 86400000));
}
// Lunes (YYYY-MM-DD) de la semana a la que pertenece una fecha. Default: hoy en Peru.
function lunesDe(iso) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : fechaPeru();
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // 0 = Lunes
  return d.toISOString().slice(0, 10);
}

// ===== Usuario en forma "publica" (plan resuelto) =====
function usuarioPublico(id) {
  // Auto-degradacion perezosa: si el plan de pago vencio, vuelve al plan Free.
  const chk = db.prepare(
    'SELECT u.rol, u.plan_expira, p.precio AS pp FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id WHERE u.id = ?'
  ).get(id);
  if (chk && chk.rol === 'user' && chk.pp > 0 && chk.plan_expira && chk.plan_expira <= fechaPeru()) {
    const free = planDefault();
    db.prepare('UPDATE usuarios SET plan_id = ?, analisis_restantes = ?, plan_expira = NULL WHERE id = ?')
      .run(free.id, free.analisis == null ? 0 : free.analisis, id);
  }

  const u = db
    .prepare(
      `SELECT u.id, u.nombre, u.email, u.rol, u.plan_id, u.analisis_restantes, u.plan_expira,
              p.nombre AS plan_nombre, p.precio AS plan_precio, p.analisis AS plan_analisis,
              p.historial_max AS plan_historial, p.platos_max AS plan_platos_max,
              p.semanas_max AS plan_semanas_max, p.generaciones_max AS plan_generaciones_max,
              p.incluye_planificador AS plan_planificador
       FROM usuarios u LEFT JOIN planes p ON p.id = u.plan_id
       WHERE u.id = ?`
    )
    .get(id);
  if (!u) return null;

  const esAdmin = u.rol === 'admin';
  const hogar = db.prepare('SELECT configurado FROM hogar WHERE usuario_id = ?').get(id);

  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    plan_id: u.plan_id,
    plan_nombre: esAdmin ? 'Administrador' : u.plan_nombre || 'Free',
    plan_precio: u.plan_precio || 0,
    analisis_restantes: u.analisis_restantes,
    // Admin: acceso total. Usuario: ilimitado si su plan no define tope de analisis.
    ilimitado: esAdmin || u.plan_analisis === null,
    incluye_planificador: esAdmin || u.plan_planificador === 1,
    // Limites (NULL = ilimitado ; admin siempre ilimitado).
    historial_max: esAdmin ? null : u.plan_historial,
    platos_max: esAdmin ? null : u.plan_platos_max,
    semanas_max: esAdmin ? null : u.plan_semanas_max,
    generaciones_max: esAdmin ? null : u.plan_generaciones_max,
    // Vencimiento del plan de pago y dias restantes.
    plan_expira: esAdmin ? null : u.plan_expira || null,
    dias_restantes: esAdmin ? null : diasHasta(u.plan_expira),
    // Gate del onboarding: sin hogar configurado el planificador no puede proponer nada.
    hogar_configurado: !!(hogar && hogar.configurado),
  };
}

// ===== Constantes de dominio =====
const MOMENTOS = ['desayuno', 'almuerzo', 'cena'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
const NIVELES = ['poco', 'normal', 'bastante'];
const CATEGORIAS_ING = [
  'abarrote', 'verdura', 'fruta', 'carne', 'pescado',
  'lacteo', 'huevo', 'legumbre', 'condimento', 'bebida', 'otro',
];
const REGIONES = ['costa', 'sierra', 'selva'];
const DIETAS = ['omnivora', 'vegetariana', 'vegana', 'pescetariana'];
const PRESUPUESTOS = ['bajo', 'medio', 'alto'];

// Sugerencias para el formulario del hogar. NO son una lista cerrada: el usuario puede
// escribir cualquier otra condicion o alergia y se guarda igual (texto libre).
// Condiciones -> la IA ADAPTA el plato. Alergias -> la IA EXCLUYE el ingrediente (duro).
const CONDICIONES_COMUNES = [
  'diabetes', 'hipertension', 'colesterol alto', 'trigliceridos altos', 'sobrepeso',
  'obesidad', 'anemia', 'gastritis', 'colon irritable', 'celiaquia',
  'intolerancia a la lactosa', 'hipotiroidismo', 'acido urico / gota',
  'enfermedad renal', 'embarazo', 'lactancia',
];
const ALERGIAS_COMUNES = [
  'mani', 'frutos secos', 'mariscos', 'pescado', 'huevo', 'leche / lacteos',
  'gluten / trigo', 'soya', 'ajonjoli', 'fresa',
];

module.exports = {
  db,
  getConfig,
  setConfig,
  getAllConfig,
  usuarioPublico,
  planDefault,
  planPremium,
  fechaPeru,
  sumarDias,
  diasHasta,
  lunesDe,
  MOMENTOS,
  DIAS,
  NIVELES,
  CATEGORIAS_ING,
  REGIONES,
  DIETAS,
  PRESUPUESTOS,
  CONDICIONES_COMUNES,
  ALERGIAS_COMUNES,
};
