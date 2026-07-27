// Cuanto de la DESPENSA se lleva lo que hay programado en el calendario.
//
// Vive aparte (fuente unica) porque lo usan DOS caminos que tienen que dar exactamente el
// mismo numero, o el usuario ve una barra que no cuadra con lo que se le descuenta:
//   1. PROYECCION  -> "esta semana te va a bajar el aji amarillo a 5%". No toca la BD.
//   2. DESCUENTO   -> al marcar la casilla como cocinada, ese mismo calculo se APLICA.
//
// Sigue sin haber gramos ni conversion de unidades (la decision de CLAUDE.md no cambio):
// lo que se mueve es el PORCENTAJE del stock, que es como razona la familia ("ya casi no
// me queda arroz"), no una medida de laboratorio.
const { db, claveIng, clampPct, sumarDias, DIA_NUM } = require('../db');

// Fecha real (YYYY-MM-DD) de una casilla: la BD guarda dia 0=Domingo (como Date.getDay())
// pero la semana empieza el LUNES, asi que el domingo es el SEPTIMO dia, no el primero.
const fechaCasilla = (semana, dia) => sumarDias(semana, DIA_NUM.indexOf(dia));

// ===== De donde sale "cuanto consume este plato de este ingrediente" =====
//
// PRIMERO la IA: cada ingrediente generado trae "consume" (0-100), y es la unica fuente
// que distingue una cucharadita de aji de medio kilo de pollo.
//
// DESPUES la heuristica, para lo que nacio sin ese dato: los platos viejos, los que el
// usuario escribio a mano en su biblioteca y los que vienen de "verificar". El peso es por
// CATEGORIA porque es el unico dato que tenemos de un ingrediente suelto, y la diferencia
// que de verdad importa es esa: un condimento dura meses y una carne se acaba en el plato.
// Sin este reparto por categoria, la sal caeria al 15% en una semana.
const PESO_CATEGORIA = {
  condimento: 5,
  abarrote: 12,
  bebida: 10,
  huevo: 20,
  lacteo: 25,
  legumbre: 25,
  fruta: 30,
  verdura: 30,
  carne: 45,
  pescado: 45,
  otro: 15,
};

// ===== Emparejar el ingrediente del plato con el producto de la despensa =====
//
// Aqui NO hay IA: es un emparejamiento local por palabras. La IA hace el emparejamiento
// SEMANTICO en el prompt (sabe que el chuño es papa seca); esto solo tiene que resolver el
// caso comun, "Pechuga de pollo" contra el "Pollo" que el usuario tiene en la despensa.
//
// Se compara por CONJUNTO DE PALABRAS, no por substring: "sal" esta contenida en "salsa de
// soya" y descontarle el stock de sal a una salsa seria un error silencioso que el usuario
// no tiene como notar. Con palabras completas, "sal" no encaja en {salsa, soya}.
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'al', 'y', 'con', 'a', 'un', 'una', 'para']);
const palabrasDe = (clave) => clave.split(' ').filter((w) => w && !VACIAS.has(w));
const subconjunto = (a, b) => a.length > 0 && a.every((w) => b.includes(w));

// Indice de la despensa del usuario, listo para emparejar muchas veces sin volver a la BD.
function indiceDespensa(usuarioId) {
  const filas = db.prepare('SELECT id, nombre, categoria, porcentaje FROM despensa WHERE usuario_id = ?').all(usuarioId);
  return filas.map((f) => {
    const clave = claveIng(f.nombre);
    return { ...f, clave, palabras: palabrasDe(clave) };
  });
}

// Devuelve la fila de despensa que cubre a este ingrediente, o null.
// Prioridad: coincidencia exacta > la mas ESPECIFICA de las que encajan por palabras.
// Lo mas especifico gana para que "Aji amarillo" no se lleve el descuento de un "Aji"
// generico cuando la familia tiene los dos productos por separado.
function emparejar(indice, nombreIng) {
  const clave = claveIng(nombreIng);
  if (!clave) return null;

  const exacta = indice.find((d) => d.clave === clave);
  if (exacta) return exacta;

  const ing = palabrasDe(clave);
  if (!ing.length) return null;

  // "Pollo" (despensa) cubre "Pechuga de pollo" (plato), y "Aji" cubre "Aji amarillo".
  const candidatos = indice.filter((d) => subconjunto(d.palabras, ing) || subconjunto(ing, d.palabras));
  if (!candidatos.length) return null;
  return candidatos.sort((a, b) => b.palabras.length - a.palabras.length)[0];
}

// Cuanto se lleva UN plato de UN ingrediente, en puntos de porcentaje.
// consume === 0 es una respuesta valida de la IA ("no gasta nada de esto"), asi que se
// distingue del ausente: solo se cae a la heuristica si el dato NO vino o no es un numero.
function consumoDeIngrediente(ing, categoria) {
  const c = Number(ing?.consume);
  if (Number.isFinite(c) && c >= 0) return clampPct(c);
  return PESO_CATEGORIA[categoria] ?? PESO_CATEGORIA.otro;
}

// ===== Como se ACUMULA el consumo de varios platos sobre el mismo producto =====
//
// Las dos fuentes se suman distinto, y no es un detalle:
//
// - LA IA da una fraccion del stock por plato ("este aji de gallina se lleva el 80% de tu
//   aji amarillo"). Dos platos que piden 40% cada uno necesitan el 80%: se SUMAN.
//
// - LA HEURISTICA no sabe cuanto pide el plato; solo sabe "una verdura se gasta harto y un
//   condimento poco". Sumarla linealmente sobre una semana de 21 platos daba resultados
//   absurdos: el aceite y el ajo, que entran en casi todo, llegaban a 0% (medido). Una casa
//   compra los basicos en tamaños proporcionales a lo que los usa. Asi que cada plato se
//   lleva su fraccion de LO QUE QUEDA: total = 1 - (1-w)^n. Nunca llega a 100 y no depende
//   de cuantos platos tenga la semana de forma explosiva.
//
// Con UN solo plato las dos formulas coinciden (1-(1-w)^1 = w), asi que el descuento real
// al marcar cocinado no cambia por esto.
function totalizar({ ia, heurW, heurN }) {
  const porHeuristica = heurN > 0 ? 100 * (1 - (1 - heurW / 100) ** heurN) : 0;
  return Math.round(ia + porHeuristica);
}

// Acumulador por producto de despensa.
const nuevoAcc = () => ({ ia: 0, heurW: 0, heurN: 0 });
function acumular(acc, pct, esHeuristico) {
  if (esHeuristico) { acc.heurW = pct; acc.heurN++; }
  else acc.ia += pct;
  return acc;
}

// Suma el consumo de UNA casilla sobre un acumulador compartido, para que varios platos
// que usan el mismo producto se acumulen segun las reglas de arriba (la IA suma, la
// heuristica satura) en vez de plato a plato.
//
// Los FALTANTES se excluyen: si la IA ya dijo que ese ingrediente no lo tiene (o que su
// version normal no le sirve por una condicion medica), no puede salir de la despensa.
// Sin esto, un hogar con "Arroz" veria bajar su arroz por un plato de "arroz integral"
// que justamente esta en la lista de compras porque NO lo tiene.
function sumarCasilla(acc, indice, plato, faltantesExtra = []) {
  const excluidos = new Set([
    ...(plato.faltantes || []).map(claveIng),
    ...faltantesExtra.map(claveIng),
  ]);

  const vistos = new Set(); // un ingrediente repetido dentro del mismo plato no cuenta dos veces
  for (const ing of plato.ingredientes || []) {
    const nombre = String(ing?.nombre || '').trim();
    if (!nombre) continue;
    const clave = claveIng(nombre);
    if (!clave || vistos.has(clave) || excluidos.has(clave)) continue;
    vistos.add(clave);

    const fila = emparejar(indice, nombre);
    if (!fila) continue; // no lo tiene en la despensa: no hay de donde descontar
    const pct = consumoDeIngrediente(ing, fila.categoria);
    if (pct <= 0) continue;
    if (!acc.has(fila.id)) acc.set(fila.id, nuevoAcc());
    acumular(acc.get(fila.id), pct, !Number.isFinite(Number(ing?.consume)));
  }
  return acc;
}

// Lee una fila (casilla + plato) y la suma al acumulador.
function sumarFila(acc, indice, fila) {
  const plato = {
    ingredientes: JSON.parse(fila.ingredientes || '[]'),
    faltantes: JSON.parse(fila.faltantes || '[]'),
  };
  let extra = [];
  if (fila.cobertura) {
    try { extra = JSON.parse(fila.cobertura).faltantes || []; } catch { /* cobertura corrupta: se ignora */ }
  }
  return sumarCasilla(acc, indice, plato, extra);
}

// Colapsa el acumulador a lo que consume el resto de la app: Map(despensa_id -> puntos).
const cerrar = (acc) => new Map([...acc].map(([id, a]) => [id, totalizar(a)]).filter(([, p]) => p > 0));

const SQL_CASILLA = `SELECT pc.id, pc.semana, pc.dia, pc.cobertura, p.ingredientes, p.faltantes
                     FROM plan_comidas pc JOIN platos p ON p.id = pc.plato_id`;

// Consumo de UNA casilla por su id (lo que se aplica al marcarla cocinada).
function consumoDeCasillaId(usuarioId, planComidaId, indice = indiceDespensa(usuarioId)) {
  const fila = db.prepare(`${SQL_CASILLA} WHERE pc.id = ? AND pc.usuario_id = ?`).get(planComidaId, usuarioId);
  return fila ? cerrar(sumarFila(new Map(), indice, fila)) : new Map();
}

// ===== Proyeccion de una ventana de fechas =====
// Solo cuenta las casillas NO cocinadas: lo que ya se cocino se descontó de verdad del
// porcentaje, y volver a proyectarlo lo restaria dos veces.
//
// La ventana se filtra por la FECHA REAL de cada casilla (semana + offset del dia), no por
// pc.semana, para que un periodo de varias semanas funcione igual que GET /plan/faltantes.
function consumoPrevisto(usuarioId, inicio, fin) {
  const indice = indiceDespensa(usuarioId);
  const filas = db.prepare(`${SQL_CASILLA} WHERE pc.usuario_id = ? AND pc.cocinado = 0`).all(usuarioId);

  const acc = new Map();
  for (const f of filas) {
    const fecha = fechaCasilla(f.semana, f.dia);
    if (fecha < inicio || fecha > fin) continue;
    sumarFila(acc, indice, f);
  }
  return cerrar(acc);
}

module.exports = {
  PESO_CATEGORIA,
  indiceDespensa,
  emparejar,
  consumoDeIngrediente,
  consumoDeCasillaId,
  consumoPrevisto,
};
