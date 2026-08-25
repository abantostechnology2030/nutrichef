// ANALISIS DE CONSUMO: mira hacia ATRAS.
//
// El resto del planificador propone lo que se va a comer; esto revisa lo que YA se comio en un
// rango de fechas y lo interpreta, para toda la familia o para un integrante concreto.
//
// Reparto del trabajo, a proposito:
//   - Los NUMEROS los suma este archivo, con lo que ya esta en la BD (platos.info, que la IA
//     calculo cuando genero cada plato). Pedirselos otra vez a la IA seria pagar por aritmetica
//     y arriesgar que devuelva cifras que no cuadran con las que el usuario ve en pantalla.
//   - La LECTURA de esos numeros para ESTE hogar (o ESTA persona) es lo unico que se le pide a
//     la IA, y en UNA sola llamada.
//
// El resumen (GET) no usa IA ni consume cupo: se puede abrir las veces que haga falta. Solo el
// informe (POST) cuesta una generacion.
const express = require('express');
const { db, MOMENTOS, fechaPeru, lunesDe, sumarDias } = require('../db');
const { requiereAuth } = require('../middleware/auth');
const { requierePlanificador, requiereHogar } = require('../middleware/planificador');
const { contextoDe, textoContexto } = require('../services/contexto');
const { analizarConsumo } = require('../services/ai.service');
const plan = require('./plan.routes');

const router = express.Router();
router.use(requiereAuth, requierePlanificador, requiereHogar);

// Los mismos 7 nutrientes que muestra el plato, con su unidad. Se listan aqui (y no se leen de
// lo que venga en info) para que un plato con un campo raro no invente una fila nueva.
const NUTRIENTES = {
  carbohidratos: 'g', proteinas: 'g', grasas: 'g', fibra: 'g', hierro: 'mg', sodio: 'mg', sal: 'g',
};

// Valores diarios de referencia de un adulto, para poder decir "el 39% de lo del dia" tambien
// en el resumen del periodo. Se calculan AQUI y no se le piden a la IA: son una constante, y
// pedirla invita a que devuelva porcentajes que no cuadran con los numeros de al lado.
// Sodio y sal siguen la recomendacion de la OMS (2 g de sodio = 5 g de sal al dia), mas exigente
// que la etiqueta habitual de 2300 mg y la que importa en un pais con mucha hipertension.
const REFERENCIA_DIARIA = {
  calorias: 2000, carbohidratos: 275, proteinas: 50, grasas: 78, fibra: 28, hierro: 18, sodio: 2000, sal: 5,
};

const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;

// Ventana pedida. Por defecto, la SEMANA ACTUAL: es el periodo que el usuario tiene delante en
// el plan, y arrancar en "los ultimos 30 dias" daria un promedio diluido por semanas sin planificar.
function ventanaPedida(q) {
  if (esFecha(q.inicio) && esFecha(q.fin) && q.inicio <= q.fin) return { inicio: q.inicio, fin: q.fin };
  const lunes = lunesDe(fechaPeru());
  return { inicio: lunes, fin: sumarDias(lunes, 6) };
}

// El resumen numerico del periodo. Sin IA.
function resumenDe(usuario, v, opciones = {}) {
  const soloCocinados = !!opciones.soloCocinados;

  const filas = db.prepare(
    `SELECT pc.semana, pc.dia, pc.momento, pc.cocinado, p.nombre, p.info, p.porciones
       FROM plan_comidas pc JOIN platos p ON p.id = pc.plato_id
      WHERE pc.usuario_id = ?`
  ).all(usuario.id)
    .map((f) => ({ ...f, fecha: plan.fechaCasilla(f.semana, f.dia) }))
    .filter((f) => f.fecha >= v.inicio && f.fecha <= v.fin)
    .filter((f) => !soloCocinados || f.cocinado)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || MOMENTOS.indexOf(a.momento) - MOMENTOS.indexOf(b.momento));

  // Totales de nutrientes. Solo suman los platos que TIENEN aporte nutricional calculado: un
  // plato sin info no vale 0, vale "no lo sabemos", y contarlo como 0 bajaria el promedio y le
  // diria a la familia que come menos de lo que come.
  const total = { calorias: 0 };
  for (const k of Object.keys(NUTRIENTES)) total[k] = 0;
  // Se cuentan por separado: un plato generado antes del aporte detallado tiene calorias pero
  // no los 7 nutrientes, y es el caso mas comun hasta que el usuario pulsa "Completar recetas".
  // Descartarlo entero por eso perderia tambien sus calorias, que si sabemos.
  let conCalorias = 0;
  let conNutrientes = 0;
  const semaforos = { verde: 0, ambar: 0, rojo: 0 };
  const porMomento = Object.fromEntries(MOMENTOS.map((m) => [m, 0]));
  const platos = [];

  for (const f of filas) {
    porMomento[f.momento] = (porMomento[f.momento] || 0) + 1;
    let info = null;
    try { info = f.info ? JSON.parse(f.info) : null; } catch { info = null; }
    if (info?.semaforo && semaforos[info.semaforo] != null) semaforos[info.semaforo]++;
    platos.push({
      nombre: f.nombre, momento: f.momento, fecha: f.fecha, cocinado: !!f.cocinado,
      calorias: info?.calorias ?? null, semaforo: info?.semaforo || null,
    });
    if (!info) continue;
    if (Number.isFinite(Number(info.calorias))) { total.calorias += Number(info.calorias); conCalorias++; }
    const n = info.nutrientes;
    if (!n || !Object.keys(n).length) continue;
    conNutrientes++;
    for (const k of Object.keys(NUTRIENTES)) {
      const val = Number(n[k]?.v);
      if (Number.isFinite(val)) total[k] += val;
    }
  }

  // El promedio se saca sobre los DIAS QUE TIENEN COMIDAS, no sobre los dias del rango: si en 30
  // dias solo hay una semana planificada, dividir entre 30 dice que la familia come 400 kcal al
  // dia, que es falso. Aun asi se avisa de cuantas comidas hay, porque un dia con solo el
  // desayuno tambien tira el promedio hacia abajo.
  const diasConPlan = new Set(filas.map((f) => f.fecha)).size;
  const div = Math.max(1, diasConPlan);
  // OJO CON LA UNIDAD: platos.info es el aporte de UNA PORCION, asi que sumar los platos de un
  // dia da lo que comio UNA PERSONA ese dia, no la olla entera. Por eso se compara con los
  // valores diarios de un adulto y por eso la clave dice "persona": leerlo como el total de la
  // familia haria pensar que comen la cuarta parte de lo que comen.
  const porDia = {};
  const vdDia = {};
  for (const k of Object.keys(total)) {
    porDia[k] = Math.round((total[k] / div) * 10) / 10;
    const ref = REFERENCIA_DIARIA[k];
    vdDia[k] = ref ? Math.round((porDia[k] / ref) * 100) : null;
  }

  // La lista de alimentos es LA MISMA que la de la lista de compras (consolidarPlan): mismo
  // dedup, mismas cantidades sumadas y mismo orden de categorias. Dos listas distintas de lo
  // mismo acabarian dando cifras distintas del mismo arroz.
  const alimentos = plan.consolidarPlan(usuario.id, v.inicio, v.fin, { soloFaltantes: false });

  return {
    ventana: { ...v, dias: diasEntre(v.inicio, v.fin), dias_con_plan: diasConPlan },
    comidas: {
      total: filas.length,
      cocinadas: filas.filter((f) => f.cocinado).length,
      con_calorias: conCalorias,
      // Los que tienen los 7 nutrientes. La pantalla lo dice: con la mitad de los platos sin
      // detalle, los totales de hierro o sodio se quedan cortos y hay que saberlo.
      con_analisis: conNutrientes,
      // Cuantas comidas CABRIAN en el rango. Es el dato que evita leer "come poco" cuando lo
      // que pasa es que solo planifico tres almuerzos.
      posibles: diasEntre(v.inicio, v.fin) * MOMENTOS.length,
      por_momento: porMomento,
    },
    unidades: { calorias: 'kcal', ...NUTRIENTES },
    total,
    por_persona_dia: porDia,
    vd_por_dia: vdDia,
    referencia_diaria: REFERENCIA_DIARIA,
    semaforos,
    platos,
    alimentos: alimentos.items,
    alimentos_por_categoria: alimentos.por_categoria,
  };
}

// El ambito: toda la familia, o un integrante concreto con lo suyo.
function ambitoDe(hogarId, integranteId) {
  if (!integranteId) return { tipo: 'familia' };
  const i = db.prepare('SELECT id, nombre, edad, condiciones, alergias, notas FROM integrantes WHERE id = ? AND hogar_id = ?')
    .get(Number(integranteId), hogarId);
  if (!i) return null;
  return {
    tipo: 'integrante',
    id: i.id,
    nombre: i.nombre,
    edad: i.edad,
    condiciones: JSON.parse(i.condiciones || '[]'),
    alergias: JSON.parse(i.alergias || '[]'),
    notas: i.notas || undefined,
  };
}

// GET /api/nutricion/resumen?inicio=&fin=&integrante_id=&solo_cocinados=1
// Los numeros del periodo. SIN IA y sin cupo.
router.get('/resumen', (req, res) => {
  const hogar = db.prepare('SELECT id FROM hogar WHERE usuario_id = ?').get(req.usuario.id);
  const ambito = ambitoDe(hogar.id, req.query.integrante_id);
  if (!ambito) return res.status(404).json({ error: 'Ese integrante no es de tu hogar.' });

  const v = ventanaPedida(req.query);
  res.json({
    ...resumenDe(req.usuario, v, { soloCocinados: req.query.solo_cocinados === '1' }),
    ambito,
    integrantes: db.prepare('SELECT id, nombre, edad, avatar FROM integrantes WHERE hogar_id = ? ORDER BY id').all(hogar.id),
  });
});

// POST /api/nutricion/informe { inicio, fin, integrante_id, solo_cocinados }
// La lectura de esos numeros. UNA llamada a la IA = una generacion de cupo.
router.post('/informe', async (req, res) => {
  const usuario = req.usuario;
  const hogar = db.prepare('SELECT id FROM hogar WHERE usuario_id = ?').get(usuario.id);
  const ambito = ambitoDe(hogar.id, req.body?.integrante_id);
  if (!ambito) return res.status(404).json({ error: 'Ese integrante no es de tu hogar.' });

  const v = ventanaPedida(req.body || {});
  const resumen = resumenDe(usuario, v, { soloCocinados: !!req.body?.solo_cocinados });

  // Sin comidas no hay nada que analizar, y llamar a la IA con una lista vacia devolveria un
  // texto generico que parece un analisis y no lo es.
  if (!resumen.comidas.total) {
    return res.status(409).json({
      error: 'No hay comidas programadas en esas fechas. Elige otro rango o programa tu semana primero.',
      vacio: true,
    });
  }

  // El cupo se cobra contra la semana ACTUAL: un analisis no pertenece a ninguna semana del
  // plan (puede cruzar varias), igual que un plato de la biblioteca.
  const semanaCupo = lunesDe(fechaPeru());
  const sinCupo = plan.cupoAgotado(usuario, semanaCupo);
  if (sinCupo) return res.status(403).json(sinCupo);

  const ctx = contextoDe(usuario.id);
  if (!ctx) return res.status(409).json({ error: 'Configura tu hogar antes de analizar.', necesita_hogar: true, redirect: '/hogar.html' });

  // A la IA se le manda el resumen SIN la lista larga de platos (los nombres ya van en
  // "alimentos" y en el conteo): son ~20 lineas que no cambian la lectura y si el costo.
  const datos = {
    ventana: resumen.ventana,
    comidas: resumen.comidas,
    unidades: resumen.unidades,
    total: resumen.total,
    promedio_por_persona_al_dia: resumen.por_persona_dia,
    porcentaje_del_valor_diario: resumen.vd_por_dia,
    valores_diarios_de_referencia: resumen.referencia_diaria,
    semaforos: resumen.semaforos,
    platos: resumen.platos.map((p) => p.nombre),
    alimentos: resumen.alimentos.map((a) => ({ nombre: a.nombre, categoria: a.categoria, en_platos: a.casillas, cantidad: a.medida })),
    sin_datos: sinDatos(resumen),
  };
  if (datos.sin_datos.length) {
    datos.aviso = `De estos nutrientes NO hay dato en el periodo porque los platos aun no tienen su detalle: ${datos.sin_datos.join(', ')}.`
      + ' Para esos, di claramente que no se sabe y recomienda completar las recetas. NO los llames bajos ni altos.';
  }

  let salida;
  try {
    const { resultado, usage } = await analizarConsumo(textoContexto(ctx), datos, ambito);
    // Se registra AUNQUE el JSON venga mal: la IA ya cobro esos tokens.
    plan.registrarGeneracion(usuario.id, semanaCupo, 'analisis', usage);
    salida = resultado;
  } catch (e) {
    console.error('[analisis]', e.message);
    return res.status(502).json({ error: 'La IA no pudo analizar el periodo. Intentalo de nuevo en un momento.' });
  }

  if (!salida || typeof salida !== 'object') {
    return res.status(502).json({ error: 'La IA devolvio una respuesta que no pudimos leer. Intentalo de nuevo.' });
  }

  res.json({ informe: normInforme(salida, resumen), resumen, ambito });
});

// Normaliza lo que devuelve la IA: los enums se validan y lo que no encaje se descarta, igual
// que en normInfo() del plato. Un "estado" inventado pintaria un color que no significa nada.
const ESTADOS = ['bajo', 'adecuado', 'alto'];
const VEREDICTOS = ['bien', 'atencion', 'riesgo'];
const texto = (v, max = 400) => {
  const t = String(v == null ? '' : v).trim();
  return t ? t.slice(0, max) : null;
};
const lista = (v, max, largo = 240) => (Array.isArray(v) ? v.map((x) => texto(x, largo)).filter(Boolean).slice(0, max) : []);

// Los nutrientes de los que no hay ni un plato que los reporte. Suma 0 no significa "no comio":
// significa "no lo sabemos", y son dos cosas muy distintas de cara al usuario.
function sinDatos(resumen) {
  return Object.keys(NUTRIENTES).filter((k) => !(resumen.total[k] > 0));
}

function normInforme(x, resumen) {
  const faltaDato = new Set(resumen ? sinDatos(resumen) : []);
  const nutrientes = {};
  for (const k of ['calorias', ...Object.keys(NUTRIENTES)]) {
    const n = x.nutrientes?.[k];
    if (!n) continue;
    let estado = ESTADOS.includes(String(n.estado || '').toLowerCase()) ? String(n.estado).toLowerCase() : null;
    // Si no hay dato, el estado se BORRA aunque la IA lo haya puesto: la pantalla pintaria
    // "Bajo" en verde/ambar junto a un comentario que dice "no tenemos registro". Ya paso.
    if (faltaDato.has(k)) estado = null;
    const comentario = texto(n.comentario);
    const sugerencia = texto(n.sugerencia);
    if (estado || comentario) nutrientes[k] = { estado, comentario, sugerencia, sin_datos: faltaDato.has(k) };
  }
  return {
    resumen: texto(x.resumen, 800),
    veredicto: VEREDICTOS.includes(String(x.veredicto || '').toLowerCase()) ? String(x.veredicto).toLowerCase() : null,
    nutrientes,
    alimentos: (Array.isArray(x.alimentos) ? x.alimentos : [])
      .map((a) => ({ nombre: texto(a?.nombre, 80), comentario: texto(a?.comentario) }))
      .filter((a) => a.nombre && a.comentario)
      .slice(0, 6),
    faltan: lista(x.faltan, 6, 80),
    sugerencias: lista(x.sugerencias, 6),
    alertas: lista(x.alertas, 5),
  };
}

module.exports = router;
