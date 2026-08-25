// Smoke test del ANALISIS DE CONSUMO (analisis.html + /api/nutricion/resumen).
//
// Lo que fija esta prueba es la ARITMETICA, que es lo que se rompe en silencio:
//   - los totales suman solo los platos que tienen el dato (un plato sin info no vale 0),
//   - el promedio se divide entre los DIAS CON COMIDAS, no entre los dias del rango,
//   - el promedio es POR PERSONA (cada plato aporta una porcion),
//   - "sin datos" y "cero" no se confunden.
//
// NO llama a la IA: solo el informe (POST) la usa, y eso cuesta. Es gratis.
//
// Crea su propio usuario, hogar, platos y semana fija: no hereda estado ni depende de la fecha.
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const db = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))(
  path.join(__dirname, '..', 'nutrichefia.db')
);

const BASE = 'http://localhost:3002';
const EMAIL = `smoke-analisis-${Date.now()}@test.pe`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Semana FIJA y lejana. Lunes.
const SEMANA = '2027-05-03';
const FIN = '2027-05-09';

async function abrir(pagina, token, usuario) {
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errores.push('jsdomError: ' + (e.detail?.message || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));
  const html = await (await fetch(`${BASE}/${pagina}`)).text();
  const dom = new JSDOM(html, {
    url: `${BASE}/${pagina}`, runScripts: 'dangerously', resources: 'usable', virtualConsole: vc,
    beforeParse(win) {
      win.localStorage.setItem('nutrichefia_token', token);
      win.localStorage.setItem('nutrichefia_user', JSON.stringify(usuario));
      win.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
    },
  });
  await esperar(2200);
  return { dom, win: dom.window, doc: dom.window.document, errores };
}

(async () => {
  let fallos = 0;
  const check = (c, m) => { console.log((c ? '  OK   ' : '  FALLA ') + m); if (!c) fallos++; };

  const reg = await (await fetch(`${BASE}/api/auth/registro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Smoke Analisis', email: EMAIL, password: 'prueba123' }),
  })).json();
  const { token, usuario } = reg;
  const apiSrv = async (ruta, opts = {}) => {
    const r = await fetch(BASE + ruta, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
  };
  const limpiar = () => {
    const r = db.prepare('DELETE FROM usuarios WHERE email = ?').run(EMAIL);
    console.log(`\n(limpieza: usuario de prueba borrado -> ${r.changes} fila)`);
  };

  try {
    await apiSrv('/api/hogar', { method: 'PUT', body: JSON.stringify({ region: 'sierra', ciudad: 'Cusco' }) });
    const integrante = await apiSrv('/api/hogar/integrantes', {
      method: 'POST', body: JSON.stringify({ nombre: 'Rosa', edad: 58, condiciones: ['hipertension'] }),
    });

    // Tres platos sembrados a mano: dos CON los 7 nutrientes y uno SIN nada. Se hace por SQL
    // porque lo que se prueba es la suma, no la generacion: con platos de la IA los numeros
    // cambiarian en cada corrida y el aserto no podria ser exacto.
    const info = (kcal, n) => JSON.stringify({
      calorias: kcal, semaforo: 'verde',
      nutrientes: {
        carbohidratos: { v: n, vd: 10 }, proteinas: { v: n, vd: 10 }, grasas: { v: n, vd: 10 },
        fibra: { v: n, vd: 10 }, hierro: { v: n, vd: 10 }, sodio: { v: n * 10, vd: 10 }, sal: { v: n / 10, vd: 10 },
      },
    });
    const sembrar = db.prepare(
      `INSERT INTO platos (usuario_id, nombre, momento, porciones, ingredientes, info, origen, guardado)
       VALUES (?, ?, ?, 2, ?, ?, 'ia', 1)`
    );
    const ing = (n) => JSON.stringify([{ nombre: n, cantidad: '1', unidad: 'taza' }]);
    const p1 = sembrar.run(usuario.id, 'Analisis desayuno', 'desayuno', ing('Quinua'), info(400, 10)).lastInsertRowid;
    const p2 = sembrar.run(usuario.id, 'Analisis almuerzo', 'almuerzo', ing('Pollo'), info(600, 20)).lastInsertRowid;
    const p3 = sembrar.run(usuario.id, 'Analisis cena', 'cena', ing('Papa'), null).lastInsertRowid;

    // Dos platos el lunes y uno el martes: dos DIAS con comidas dentro de un rango de siete.
    await apiSrv('/api/plan', { method: 'POST', body: JSON.stringify({ semana: SEMANA, dia: 1, momento: 'desayuno', plato_id: p1 }) });
    await apiSrv('/api/plan', { method: 'POST', body: JSON.stringify({ semana: SEMANA, dia: 1, momento: 'almuerzo', plato_id: p2 }) });
    await apiSrv('/api/plan', { method: 'POST', body: JSON.stringify({ semana: SEMANA, dia: 2, momento: 'cena', plato_id: p3 }) });

    console.log('=== /api/nutricion/resumen ===');
    const r = await apiSrv(`/api/nutricion/resumen?inicio=${SEMANA}&fin=${FIN}`);
    check(r.status === 200, `responde 200 (fue ${r.status})`);
    const d = r.cuerpo;

    check(d.comidas.total === 3, `cuenta las 3 comidas del rango (= ${d.comidas.total})`);
    check(d.comidas.posibles === 21, `y dice cuantas cabrian: ${d.comidas.posibles}`);
    check(d.comidas.con_analisis === 2, `2 de 3 tienen el detalle de nutrientes (= ${d.comidas.con_analisis})`);
    check(d.comidas.con_calorias === 2, `y 2 tienen calorias (= ${d.comidas.con_calorias})`);
    check(d.ventana.dias === 7 && d.ventana.dias_con_plan === 2,
      `${d.ventana.dias} dias de rango, ${d.ventana.dias_con_plan} con comidas`);

    // 400 + 600 = 1000 kcal. El plato sin info NO suma 0: no se cuenta.
    check(d.total.calorias === 1000, `suma las calorias de los que las tienen: ${d.total.calorias}`);
    check(d.total.fibra === 30, `suma la fibra: 10 + 20 = ${d.total.fibra}`);
    check(d.total.sodio === 300, `suma el sodio: 100 + 200 = ${d.total.sodio}`);

    // El promedio se divide entre los DIAS CON COMIDAS (2), no entre los 7 del rango: si no,
    // una semana con dos dias planificados diria que la familia come 143 kcal al dia.
    check(d.por_persona_dia.calorias === 500, `promedio por persona y dia: 1000/2 = ${d.por_persona_dia.calorias}`);
    check(d.vd_por_dia.calorias === 25, `y su % del valor diario: 500/2000 = ${d.vd_por_dia.calorias}%`);
    check(d.referencia_diaria.sodio === 2000, 'el sodio se compara con la referencia de la OMS (2000 mg)');

    // La lista de alimentos es la misma que la de la lista de compras.
    const nombres = d.alimentos.map((a) => a.nombre).sort().join(', ');
    check(nombres === 'Papa, Pollo, Quinua', `lista los alimentos del periodo: ${nombres}`);

    // Filtrar por integrante no cambia la comida (la familia come lo mismo): cambia la lente.
    const rInt = await apiSrv(`/api/nutricion/resumen?inicio=${SEMANA}&fin=${FIN}&integrante_id=${integrante.cuerpo.integrantes[0].id}`);
    check(rInt.cuerpo.ambito.tipo === 'integrante' && rInt.cuerpo.ambito.nombre === 'Rosa',
      `el ambito es de Rosa (${rInt.cuerpo.ambito.nombre})`);
    check(rInt.cuerpo.ambito.condiciones.includes('hipertension'), 'y lleva sus condiciones medicas');
    check(rInt.cuerpo.total.calorias === d.total.calorias, 'los alimentos son los mismos que los de la familia');

    // Solo cocinados: no hay ninguno marcado, asi que la lista queda vacia.
    const rCoc = await apiSrv(`/api/nutricion/resumen?inicio=${SEMANA}&fin=${FIN}&solo_cocinados=1`);
    check(rCoc.cuerpo.comidas.total === 0, `"solo cocinados" no cuenta lo que solo esta programado (= ${rCoc.cuerpo.comidas.total})`);

    // Un integrante de otro hogar no se puede espiar.
    const ajeno = await apiSrv(`/api/nutricion/resumen?integrante_id=999999`);
    check(ajeno.status === 404, `un integrante que no es tuyo da 404 (fue ${ajeno.status})`);

    console.log('\n=== analisis.html ===');
    const pg = await abrir(`analisis.html?inicio=${SEMANA}&fin=${FIN}`, token, usuario);
    check(pg.errores.length === 0, `sin errores de runtime ${pg.errores.join(' | ')}`);
    const txt = (s) => (pg.doc.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim();
    check(/3 comida/.test(txt('#pill-gen')), `la pill cuenta las comidas: "${txt('#pill-gen')}"`);
    check(pg.doc.querySelectorAll('.nutri-fila').length === 8, 'pinta las 8 filas (energia + 7 nutrientes)');
    check([...pg.doc.querySelectorAll('#f-quien option')].length === 2, 'el selector ofrece la familia y a Rosa');
    check(/todavía no tienen el detalle/i.test(txt('#resumen')), 'avisa de los platos sin detalle nutricional');
    check(/3 de 21/.test(txt('#resumen')), 'y de cuantas comidas hay programadas de las posibles');
    check(!!pg.doc.getElementById('btn-analizar'), 'ofrece el boton de analizar con IA');
    check(/una generación de IA/i.test(txt('#informe')), 'y avisa de que cuesta una generacion');
    pg.win.close();

    // Un rango sin comidas no es un error: se explica y se invita a programar.
    const vacio = await abrir('analisis.html?inicio=2027-09-06&fin=2027-09-12', token, usuario);
    check(/No hay comidas programadas/i.test(vacio.doc.querySelector('#resumen')?.textContent || ''),
      'un rango vacio lo dice en vez de pintar ceros');
    vacio.win.close();
  } finally {
    limpiar();
  }

  console.log(fallos ? `\n=== ${fallos} FALLO(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
