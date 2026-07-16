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

  const despensa = db.prepare('SELECT nombre, categoria, nivel FROM despensa WHERE usuario_id = ? ORDER BY categoria, nombre')
    .all(usuarioId);

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
      notas: hogar.notas || undefined,
    },
    integrantes,
    alergias,     // union: exclusion absoluta
    condiciones,  // union: adaptaciones del plato
    despensa,
  };
}

// Bloque de texto que se antepone a los prompts del planificador.
// Se construye una sola vez para que generar, regenerar y verificar "vean" lo mismo.
function textoContexto(ctx) {
  const partes = [
    `HOGAR: ${ctx.hogar.comensales} comensal(es). Region: ${ctx.hogar.region}${ctx.hogar.ciudad ? ` (${ctx.hogar.ciudad})` : ''}. Dieta: ${ctx.hogar.dieta}. Presupuesto: ${ctx.hogar.presupuesto}.`,
    `INTEGRANTES: ${JSON.stringify(ctx.integrantes)}`,
  ];
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
  partes.push(
    ctx.despensa.length
      ? `DESPENSA (lo que YA tiene en casa, con cuanto le queda): ${JSON.stringify(ctx.despensa.map((d) => ({ nombre: d.nombre, tengo: d.nivel })))}`
      : 'DESPENSA: vacia (no tiene ingredientes registrados).'
  );
  if (ctx.hogar.notas) partes.push(`NOTAS DE LA FAMILIA: ${ctx.hogar.notas}`);

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
