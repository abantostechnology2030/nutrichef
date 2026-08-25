// Arma el CONTEXTO del usuario que se le manda a la IA: quienes son, que comen,
// que no pueden comer y con que cuentan.
//
// Vive aparte porque lo usan varios flujos (generar menu, regenerar dia/plato,
// verificar platos propuestos) y todos deben ver EXACTAMENTE la misma verdad: si
// cada ruta armara su propio contexto, una podria olvidar las alergias.
const { db, getConfig } = require('../db');

// Une las alergias de TODOS los integrantes en una sola lista.
// Se calcula aqui, una vez, porque es la restriccion DURA del prompt: si una alergia
// de un integrante se perdiera por el camino, el plato propuesto podria dañarlo.
function contextoDe(usuarioId) {
  const hogar = db.prepare('SELECT * FROM hogar WHERE usuario_id = ?').get(usuarioId);
  if (!hogar) return null;

  const integrantes = db.prepare('SELECT nombre, edad, condiciones, alergias, notas FROM integrantes WHERE hogar_id = ? ORDER BY id')
    .all(hogar.id)
    .map((i) => ({
      nombre: i.nombre,
      edad: i.edad,
      condiciones: JSON.parse(i.condiciones || '[]'),
      alergias: JSON.parse(i.alergias || '[]'),
      notas: i.notas || undefined,
    }));

  // Con el modulo apagado NI SIQUIERA SE CONSULTA: el contexto es lo unico que la IA ve, asi
  // que una despensa vacia aqui es la forma correcta de "apagarla del todo". Si se consultara
  // y se filtrara mas adelante, cualquier flujo nuevo que olvidara el filtro la colaria.
  const despensaActiva = !!hogar.despensa_activa;
  const despensa = despensaActiva
    ? db.prepare('SELECT nombre, categoria, nivel, porcentaje FROM despensa WHERE usuario_id = ? ORDER BY categoria, nombre').all(usuarioId)
    : [];

  const unicos = (arr) => [...new Map(arr.map((x) => [x.toLowerCase(), x])).values()];
  const alergias = unicos(integrantes.flatMap((i) => i.alergias));
  const condiciones = unicos(integrantes.flatMap((i) => i.condiciones));

  return {
    hogar: {
      region: hogar.region,
      ciudad: hogar.ciudad || undefined,
      dieta: hogar.dieta,
      presupuesto: hogar.presupuesto,
      comensales: hogar.comensales,
      // Semanas que cubre su compra. Va al prompt porque el 100% de la despensa ES la
      // necesidad del periodo: sin este dato, "queda 50%" no le dice a la IA si le sobra
      // media semana o dos meses.
      semanas: Math.max(1, Math.min(12, hogar.semanas || 1)),
      notas: hogar.notas || undefined,
    },
    integrantes,
    alergias,     // union: exclusion absoluta
    condiciones,  // union: adaptaciones del plato
    despensa,
    despensaActiva,
  };
}

// Bloque de texto que se antepone a los prompts del planificador.
// Se construye una sola vez para que generar, regenerar y verificar "vean" lo mismo.
function textoContexto(ctx) {
  const sem = ctx.hogar.semanas;
  const partes = [
    `HOGAR: ${ctx.hogar.comensales} comensal(es). Region: ${ctx.hogar.region}${ctx.hogar.ciudad ? ` (${ctx.hogar.ciudad})` : ''}. Dieta: ${ctx.hogar.dieta}. Presupuesto: ${ctx.hogar.presupuesto}.`,
    `INTEGRANTES: ${JSON.stringify(ctx.integrantes)}`,
  ];
  // El periodo solo significa algo si hay despensa: es la referencia del "queda %".
  if (ctx.despensaActiva) {
    partes.splice(1, 0, `PERIODO DE LA COMPRA: ${sem} semana(s). La despensa de abajo esta comprada para cubrir ese periodo.`);
  }
  // Las alergias se repiten aparte (aunque ya vayan en integrantes) para que la
  // restriccion dura quede imposible de pasar por alto.
  partes.push(
    ctx.alergias.length
      ? `ALERGIAS DEL HOGAR (PROHIBIDO ABSOLUTO, en cualquier forma o traza): ${ctx.alergias.join(', ')}`
      : 'ALERGIAS DEL HOGAR: ninguna declarada.'
  );
  partes.push(
    ctx.condiciones.length
      ? `CONDICIONES MEDICAS A RESPETAR: ${ctx.condiciones.join(', ')}`
      : 'CONDICIONES MEDICAS: ninguna declarada.'
  );
  // "queda" va en PORCENTAJE (0-100) y no como etiqueta poco/normal/bastante: es el dato
  // real que guarda la despensa, y es el mismo lenguaje en el que la IA debe devolver el
  // "consume" de cada ingrediente. Con dos escalas distintas (palabra a la entrada, numero
  // a la salida) la estimacion no tendria contra que calibrarse.
  //
  // El 100% es LA NECESIDAD DEL PERIODO, no el envase lleno (ver FORMATO_CONSUME). Se dice
  // explicitamente y con el periodo delante para que la IA lea "queda 25%" como "le alcanza
  // para un cuarto de su periodo", que es lo que significa.
  // Con el modulo apagado se le DICE que no hay despensa y que no debe razonar sobre ella.
  // No basta con omitir el bloque: las reglas del prompt hablan de la despensa, y sin este
  // aviso la IA se inventa que el hogar "tiene" cosas o marca faltantes que no significan nada.
  if (!ctx.despensaActiva) {
    partes.push('DESPENSA: esta familia NO lleva inventario de despensa. NO supongas que tiene ni que le falta ningun ingrediente, NO menciones su despensa y devuelve SIEMPRE "faltantes": [] y "consume": 0. Propon los platos libremente segun su region, dieta, presupuesto y condiciones medicas.');
  } else {
    partes.push(
      ctx.despensa.length
        ? `DESPENSA (lo que YA tiene en casa; "queda" es el % que le sobra de ese producto MEDIDO SOBRE LO QUE NECESITA PARA EL PERIODO COMPLETO de ${sem} semana(s): 100 = tiene todo lo que necesita para el periodo, 50 = le alcanza para la mitad, 0 = se le acabo): ${JSON.stringify(ctx.despensa.map((d) => ({ nombre: d.nombre, queda: `${d.porcentaje}%` })))}`
        : 'DESPENSA: vacia (no tiene ingredientes registrados).'
    );
  }
  // Las escribio el usuario y son la parte del contexto que mas le importa a el: se nombran
  // como PETICIONES (la regla 9 del prompt las trata como obligatorias) y no como "notas", que
  // se leia como un comentario de fondo. Ya paso: un hogar pidio ensalada y bebida en cada
  // almuerzo y la IA lo cumplia solo a ratos.
  if (ctx.hogar.notas) partes.push(`PETICIONES DE LA FAMILIA (obligatorias, salvo que choquen con una alergia o condicion medica): ${ctx.hogar.notas}`);

  // Instrucciones generales del admin (config.ia_instrucciones): valen para TODOS los
  // hogares y se anteponen a todos los flujos del planificador. NUNCA por encima de las
  // reglas duras: las alergias y condiciones medicas mandan aunque una instruccion diga
  // otra cosa (lo dejamos explicito para que un texto del admin no baje esa proteccion).
  const instrucciones = (getConfig('ia_instrucciones') || '').trim();
  if (instrucciones) {
    partes.push(`INSTRUCCIONES GENERALES DEL SERVICIO (tenlas SIEMPRE en cuenta al proponer y adaptar los platos, salvo que choquen con una alergia o condicion medica del hogar, que siempre mandan): ${instrucciones}`);
  }
  return partes.join('\n');
}

module.exports = { contextoDe, textoContexto };
