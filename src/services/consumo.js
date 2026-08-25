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
const { db, claveIng, sumarDias, DIA_NUM } = require('../db');

// Fecha real (YYYY-MM-DD) de una casilla: la BD guarda dia 0=Domingo (como Date.getDay())
// pero la semana empieza el LUNES, asi que el domingo es el SEPTIMO dia, no el primero.
const fechaCasilla = (semana, dia) => sumarDias(semana, DIA_NUM.indexOf(dia));

// ===== La escala: el 100% es LA NECESIDAD DEL PERIODO, no el envase =====
//
// Un producto al 100% significa "tengo todo lo que necesito de esto para el periodo que
// compre"; al 50%, "me alcanza para la mitad". No significa "el envase esta lleno" (que es
// lo que significaba hasta el 2026-07-29, y con esa referencia los numeros no cuadraban con
// nada). Con la necesidad como ancla el modelo CIERRA: cocinar todo lo planificado del
// periodo deja cada producto cerca de 0.
//
// Todo lo de aqui se razona sobre UNA SEMANA y se divide por las semanas del periodo al
// final (ver semanasDelPeriodo). Pedirle a la IA el numero directamente sobre un periodo de
// 12 semanas daria ~1% por plato: entero, redondeado, y la barra no se moveria nunca.

// ===== De donde sale "cuanto consume este plato de este ingrediente" =====
//
// PRIMERO la IA: cada ingrediente generado trae "consume" (0-100 de la necesidad SEMANAL), y
// es la unica fuente que distingue una cucharadita de aji de medio kilo de pollo.
//
// DESPUES la heuristica, para lo que nacio sin ese dato: los platos que el usuario escribio a
// mano en su biblioteca (no pasan por IA) y los viejos que aun no se completaron con
// /detallar. El peso es por CATEGORIA porque es el unico dato que tenemos de un ingrediente
// suelto.
//
// Cada peso es "100 repartido entre los platos de UNA SEMANA que usan ese producto", la
// misma regla que se le da a la IA en FORMATO_CONSUME — si las dos fuentes no compartieran
// criterio, dos platos iguales moverian la barra distinto segun quien los creo. El comentario
// de cada linea es la frecuencia semanal asumida (el divisor de 100).
//
// LOS NUMEROS SALEN DE CONTAR UNA SEMANA REAL, no a ojo: en la semana sembrada del hogar de
// prueba (21 platos), la cebolla entra en 14, el ajo en 12, la sal en ~18 y el pollo en 7.
// Con el "carne: 33" que tenia al principio (que asumia 3 platos), esos 7 platos de pollo
// proyectaban -77% de un periodo de 3 semanas: una semana no puede comerse tres cuartos de
// una compra de tres semanas.
//
// AUN ASI ES UNA APROXIMACION GRUESA, y la unica que se puede hacer con la categoria como
// unico dato: la papa y la cebolla son las dos "verdura" y no aparecen ni la misma cantidad
// de veces ni en la misma proporcion del plato. Por eso esto es SOLO el respaldo de los
// platos manuales; la precision de verdad la da el "consume" de la IA, que si ve el plato.
// Ojo con un detalle de datos: en ingredientes_catalogo la SAL y el AZUCAR son 'abarrote',
// no 'condimento', asi que se llevan el peso de abarrote.
const PESO_CATEGORIA = {
  condimento: 6,   // comino, pimienta, oregano, culantro: ~18 platos
  verdura: 9,      // cebolla, ajo, tomate: ~11 platos (los aromaticos dominan la categoria)
  abarrote: 12,    // arroz, aceite, fideos, sal, azucar: ~8 platos
  bebida: 14,      // ~7
  carne: 16,       // ~6: el pollo entra a diario en una casa peruana
  huevo: 16,       // ~6
  otro: 16,        // ~6
  fruta: 20,       // ~5
  lacteo: 20,      // ~5
  pescado: 33,     // ~3
  legumbre: 50,    // lentejas, frejoles: 1-2 platos por semana
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
// Con el modulo apagado no hay nada que proyectar ni que descontar. Se corta AQUI, en la
// fuente que usan los dos caminos (la proyeccion y el descuento real), para que ninguno pueda
// olvidarse del interruptor por su cuenta.
function despensaActiva(usuarioId) {
  const h = db.prepare('SELECT despensa_activa FROM hogar WHERE usuario_id = ?').get(usuarioId);
  return !!(h && h.despensa_activa);
}

function indiceDespensa(usuarioId) {
  if (!despensaActiva(usuarioId)) return [];
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

// Cuanto se lleva UN plato de UN ingrediente, en puntos de la necesidad SEMANAL. Sin
// redondear ni clampear todavia: la division por el periodo y el redondeo van al final, en
// cerrar(). Redondeando aqui, un plato de 6 puntos en un periodo de 4 semanas daria 2 en vez
// de 1,5 y la suma de la semana se iria un 33% arriba.
//
// consume === 0 es una respuesta valida de la IA ("no gasta nada de esto"), asi que se
// distingue del ausente: solo se cae a la heuristica si el dato NO vino o no es un numero.
function consumoDeIngrediente(ing, categoria) {
  const c = Number(ing?.consume);
  if (Number.isFinite(c) && c >= 0) return Math.max(0, Math.min(100, c));
  return PESO_CATEGORIA[categoria] ?? PESO_CATEGORIA.otro;
}

// ===== Como se ACUMULA el consumo de varios platos sobre el mismo producto =====
//
// SE SUMAN, las dos fuentes igual. Ambas son ya una fraccion de LA MISMA cosa (lo que la
// familia necesita de ese producto en una semana), asi que dos platos que piden 20 cada uno
// piden 40 de la semana. Y por eso el modelo cierra: los platos de una semana que usan sal
// suman ~100 de la sal de esa semana.
//
// ANTES la heuristica se acumulaba SATURANDO (1-(1-w)^n) y no era un capricho: con el ancla
// vieja ("100 = el envase lleno") sumar linealmente dejaba el aceite y el ajo en 0% en una
// semana, porque una casa compra los basicos en envases proporcionales a lo que los usa. Al
// pasar el ancla a la necesidad del periodo, esa correccion sobra: llegar a 100 tras una
// semana de platos es exactamente lo que tiene que pasar. Si vuelves a tocar la escala,
// vuelve a mirar esto: los dos cambios van juntos.
function totalizar({ ia, heur }, semanas) {
  return (ia + heur) / semanas;
}

// Acumulador por producto de despensa.
const nuevoAcc = () => ({ ia: 0, heur: 0 });
function acumular(acc, pct, esHeuristico) {
  if (esHeuristico) acc.heur += pct;
  else acc.ia += pct;
  return acc;
}

// Semanas que cubre la compra del usuario = el divisor de todo lo de arriba.
//
// Sale de hogar.semanas, que es la preferencia sticky que la compra usa por defecto y el
// unico numero de "periodo" que el usuario declara de forma estable. Una compra con fechas a
// medida (periodo_inicio/fin sueltos) no la toca, asi que ahi el divisor es el de su ultima
// compra por semanas: es una aproximacion asumida, no un descuido.
function semanasDelPeriodo(usuarioId) {
  const n = db.prepare('SELECT semanas FROM hogar WHERE usuario_id = ?').get(usuarioId)?.semanas;
  return Math.max(1, Math.min(12, Number(n) || 1));
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
// Aqui, y solo aqui, se divide por el periodo y se redondea: la acumulacion de arriba es
// decimal a proposito (ver consumoDeIngrediente). Un producto que no llega a medio punto se
// cae de la lista — con un periodo de 12 semanas, un plato de 250 no debe mover la barra.
const cerrar = (acc, semanas) =>
  new Map([...acc]
    .map(([id, a]) => [id, Math.round(totalizar(a, semanas))])
    .filter(([, p]) => p > 0));

const SQL_CASILLA = `SELECT pc.id, pc.semana, pc.dia, pc.cobertura, p.ingredientes, p.faltantes
                     FROM plan_comidas pc JOIN platos p ON p.id = pc.plato_id`;

// Consumo de UNA casilla por su id (lo que se aplica al marcarla cocinada).
function consumoDeCasillaId(usuarioId, planComidaId, indice = indiceDespensa(usuarioId)) {
  const fila = db.prepare(`${SQL_CASILLA} WHERE pc.id = ? AND pc.usuario_id = ?`).get(planComidaId, usuarioId);
  return fila ? cerrar(sumarFila(new Map(), indice, fila), semanasDelPeriodo(usuarioId)) : new Map();
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
  return cerrar(acc, semanasDelPeriodo(usuarioId));
}

module.exports = {
  PESO_CATEGORIA,
  indiceDespensa,
  emparejar,
  consumoDeIngrediente,
  consumoDeCasillaId,
  consumoPrevisto,
  semanasDelPeriodo,
};
