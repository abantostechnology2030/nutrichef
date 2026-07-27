// Smoke test de plan.html: carga el calendario en un DOM real (jsdom) y lo maneja
// contra el servidor de verdad. Ver pruebas/README.md.
//
// ⚠️ GASTA DINERO: 4 llamadas REALES a la IA (dia + plato + 2 verificaciones), ~60s.
//   $0.012 con gemini  |  $0.047 con claude  <- depende de ai_prioridad en la BD.
// El local suele estar en prioridad claude: si vas a iterar sobre este test, ponlo en
// gemini (setConfig('ai_prioridad','gemini')) o cada corrida cuesta 4x.
// Usa la semana SEMANA (futura y vacia) para no pisar el plan de prueba.
//
// La segunda generacion no es un capricho: verifica LA invariante del planificador — que
// generar un dia llena solo las casillas VACIAS y no pisa lo que ya estaba. Sin ella el
// test no distinguiria "llenar" de "arrasar el dia".
//
// Requiere: servidor en :3002 + el usuario de prueba + hogar configurado + despensa.
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://localhost:3002';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await esperar(1500);
  return { win: dom.window, doc: dom.window.document, errores };
}
const txt = (doc, sel) => (doc.querySelector(sel)?.textContent || '').trim().replace(/\s+/g, ' ');

(async () => {
  const { token, usuario } = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fam@test.pe', password: 'prueba123' }),
  })).json();

  let fallos = 0;
  const check = (c, m) => { console.log((c ? '  OK   ' : '  FALLA ') + m); if (!c) fallos++; };
  const apiSrv = (ruta, opts = {}) => fetch(BASE + ruta, {
    ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }).then((r) => r.json());

  // El cupo de generaciones es POR SEMANA del plan: se usa una semana futura y vacia
  // para tener cupo fresco sin tocar el plan de la semana actual.
  const SEMANA = '2026-08-10';

  // Vaciar la semana de prueba AL EMPEZAR, no solo al terminar. La limpieza final no
  // alcanza: si una corrida se cae a medias (o alguien genera ahi a mano probando), deja
  // platos que hacen fallar la SIGUIENTE con un "la semana no esta vacia" que no tiene
  // nada que ver con lo que se esta probando. Ya me paso.
  const vaciarSemana = async () => {
    const plan = await apiSrv(`/api/plan?semana=${SEMANA}`);
    let n = 0;
    for (const d of plan.dia_orden) for (const m of plan.momentos) {
      const it = plan.plan[d][m];
      if (it) { await apiSrv(`/api/plan/${it.id}`, { method: 'DELETE' }); n++; }
    }
    return n;
  };
  const sobras = await vaciarSemana();
  if (sobras) console.log(`(estado inicial: se limpiaron ${sobras} casillas que habian quedado de antes)`);

  // La seccion de "carga y estructura" necesita una semana LLENA, y la que se abre por
  // defecto es la ACTUAL. Antes daba por hecho que el menu sembrado caia en la semana de
  // hoy: funcionaba la semana en que se sembro y se rompia sola en cuanto pasaba el tiempo
  // (falla real: "las 21 casillas tienen plato" con el menu sembrado 2 semanas atras).
  //
  // Se copia la semana mas llena que tenga el usuario a la semana actual. Es GRATIS (copiar
  // apunta a los mismos platos, no llama a la IA) y deja el estado fijado en vez de heredado.
  const semanaActual = await apiSrv('/api/plan').then((p) => p.semana);
  let copiadaAqui = false;
  {
    const { semanas } = await apiSrv('/api/plan/semanas');
    const origen = semanas.filter((s) => s.semana !== semanaActual).sort((a, b) => b.items - a.items)[0];
    const actual = await apiSrv(`/api/plan?semana=${semanaActual}`);
    const llenasHoy = actual.dia_orden.reduce((n, d) => n + actual.momentos.filter((m) => actual.plan[d][m]).length, 0);
    if (llenasHoy === 0 && origen && origen.items >= 21) {
      await apiSrv('/api/plan/copiar', { method: 'POST', body: JSON.stringify({ desde: origen.semana, hacia: semanaActual }) });
      copiadaAqui = true;
      console.log(`(estado inicial: se copio el menu de ${origen.semana} a la semana actual para probar la carga)`);
    }
  }

  console.log('\n=== plan.html: carga y estructura ===');
  const { doc, errores } = await abrir('plan.html', token, usuario);
  check(errores.length === 0, `sin errores de runtime ${errores.length ? '-> ' + errores.join(' | ') : ''}`);
  check(doc.querySelectorAll('.dia-fila').length === 7, `7 dias pintados (= ${doc.querySelectorAll('.dia-fila').length})`);
  check(doc.querySelectorAll('.casilla').length === 21, `21 casillas (7x3) (= ${doc.querySelectorAll('.casilla').length})`);
  check(txt(doc, '.dia-fila:first-child .dia-nombre') === 'Lunes', `la semana empieza en Lunes (= "${txt(doc, '.dia-fila:first-child .dia-nombre')}")`);
  check(txt(doc, '.dia-fila:last-child .dia-nombre') === 'Domingo', `y termina en Domingo (= "${txt(doc, '.dia-fila:last-child .dia-nombre')}")`);
  check(doc.querySelector('#aviso-setup').classList.contains('hidden'), 'sin aviso de setup (hogar y despensa listos)');
  check(/generaciones/.test(txt(doc, '#pill-gen')), `pill de generaciones: "${txt(doc, '#pill-gen')}"`);
  check(doc.querySelectorAll('.casilla:not(.vacia)').length === 21, 'las 21 casillas tienen plato (menu ya generado antes)');
  check(doc.querySelectorAll('.tag-falta, .tag-ok').length === 21, 'cada casilla muestra si falta comprar o no');
  check(/periodo|compra/i.test(txt(doc, '#badge-periodo')), `el badge de periodo se pinta: "${txt(doc, '#badge-periodo')}"`);

  // El dia de hoy se resalta.
  check(doc.querySelectorAll('.dia-fila.hoy').length <= 1, 'a lo sumo un dia marcado como hoy');

  // Modal de detalle.
  doc.querySelector('[data-ver]').click();
  await esperar(200);
  check(!!doc.querySelector('.modal-back'), 'el modal de detalle del plato se abre');
  check(doc.querySelectorAll('.modal-back li').length > 0, `el detalle lista ingredientes (= ${doc.querySelectorAll('.modal-back li').length})`);
  doc.querySelector('.modal-back [data-cerrar]').click();
  await esperar(120);
  check(!doc.querySelector('.modal-back'), 'el modal se cierra');

  // Navegacion de semanas.
  const semAntes = txt(doc, '#lbl-semana');
  doc.querySelector('#btn-next').click();
  await esperar(900);
  check(txt(doc, '#lbl-semana') !== semAntes, `navegar a la semana siguiente cambia el rango (${semAntes} -> ${txt(doc, '#lbl-semana')})`);
  check(doc.querySelectorAll('.casilla.vacia').length === 21, 'la semana siguiente esta vacia (21 casillas sin plato)');
  doc.querySelector('#btn-hoy').click();
  await esperar(900);
  check(txt(doc, '#lbl-semana') === semAntes, 'el boton Hoy vuelve a la semana actual');
  check(txt(doc, '#lbl-semana-sub') === 'Semana actual', 'y la marca como semana actual');

  // ===== Generacion real desde la UI (en una semana futura, con cupo libre) =====
  // La unidad de generacion es el DIA: no existe boton de "generar la semana".
  console.log('\n=== plan.html: generar UN DIA con IA (real) ===');
  const { doc: doc2, errores: err2 } = await abrir(`plan.html`, token, usuario);
  await esperar(300);
  // Navegar a la semana de prueba.
  doc2.defaultView.cargar(SEMANA);
  await esperar(1200);
  check(err2.length === 0, `sin errores de runtime ${err2.length ? '-> ' + err2.join(' | ') : ''}`);
  check(doc2.querySelectorAll('.casilla.vacia').length === 21, 'semana de prueba vacia (21 casillas)');
  check(!doc2.querySelector('#btn-generar'), 'ya NO existe el boton de generar la semana completa');

  // Lunes = la primera fila. Sus 3 casillas, en orden desayuno/almuerzo/cena.
  const lunes = () => doc2.querySelector('.dia-fila:first-child');
  const casillasLunes = () => lunes().querySelectorAll('.casilla');
  const vaciasLunes = () => lunes().querySelectorAll('.casilla.vacia').length;
  const nombreCasilla = (i) => (casillasLunes()[i].querySelector('.casilla-plato')?.textContent || '').trim();

  const btnDia = lunes().querySelector('[data-gen-dia]');
  check(!!btnDia && !btnDia.disabled, 'el boton del dia esta habilitado (hay cupo)');
  check(/Generar día/.test(btnDia.textContent), `el boton dice "Generar día" con el dia vacio ("${btnDia.textContent.trim()}")`);

  btnDia.click();
  await esperar(400);
  // Mientras la IA piensa (~30s) la UI DEBE avisar: el boton solo puede mostrar "✨…" y sin
  // este mensaje el usuario cree que la app no responde. Ya paso una vez.
  check(/Cocinando los platos del día/.test(txt(doc2, '#alerta-plan')),
    `avisa que esta trabajando durante la espera ("${txt(doc2, '#alerta-plan')}")`);

  // Esperar a que la IA responda (hasta 90s).
  for (let i = 0; i < 90 && vaciasLunes() === 3; i++) await esperar(1000);
  check(vaciasLunes() === 0, `la IA lleno las 3 casillas del lunes (vacias = ${vaciasLunes()})`);
  check(doc2.querySelectorAll('.casilla:not(.vacia)').length === 3, 'y NO toco los otros 6 dias (solo 3 casillas llenas en la semana)');

  // Cada plato generado nace COMPLETO: con receta (pasos) y aporte nutricional (info).
  // Si esto falla, el techo de tokens se quedo corto o el prompt dejo de pedir los pasos.
  const platosLunes = (await apiSrv(`/api/plan?semana=${SEMANA}`)).plan[1];
  for (const m of ['desayuno', 'almuerzo', 'cena']) {
    const p = platosLunes[m]?.plato;
    check(!!p?.pasos?.length, `${m}: el plato generado trae su receta (${p?.pasos?.length || 0} pasos)`);
    check(!!p?.info, `${m}: y su aporte nutricional`);
    check(!(p?.pasos || []).some((s) => /^\s*\d+\s*[.)-]/.test(s)), `${m}: los pasos no vienen numerados (el <ol> ya numera)`);
  }

  // Lista de compras (Fase 5): consolida y DEDUPLICA los faltantes del periodo. Los 3
  // platos recien generados traen faltantes; la lista los junta por pasillo, sin repetir.
  const falt = await apiSrv(`/api/plan/faltantes?inicio=${SEMANA}`);
  check(falt.total >= 1, `la lista junta los faltantes del dia (total = ${falt.total})`);
  check((falt.por_categoria || []).every((g) => g.items.length), 'agrupada por categoria, sin grupos vacios');
  const sinDobles = falt.items.every((i, n) =>
    falt.items.findIndex((o) => o.nombre.toLowerCase() === i.nombre.toLowerCase()) === n);
  check(sinDobles, 'sin nombres duplicados en la lista consolidada');
  // Y el detalle los muestra en vez del aviso de "todavia no tiene receta".
  doc2.querySelector('.dia-fila:first-child .casilla [data-ver]').click();
  await esperar(250);
  const detalle = (doc2.querySelector('.modal-back')?.textContent || '').replace(/\s+/g, ' ');
  check(/Cómo prepararlo/.test(detalle), 'el modal "Ver" muestra la receta del plato generado');
  check(!/todavía no tiene su receta/.test(detalle), 'y no el aviso de receta pendiente');
  doc2.querySelector('.modal-back [data-cerrar]')?.click();
  check(/generado/i.test(txt(doc2, '#alerta-plan')), `mensaje de exito: "${txt(doc2, '#alerta-plan')}"`);
  check(/1\/\d|∞/.test(txt(doc2, '#pill-gen')), `el contador de generaciones se actualizo: "${txt(doc2, '#pill-gen')}"`);
  check(/Rehacer día/.test(lunes().querySelector('[data-gen-dia]').textContent), 'con el dia lleno, el boton pasa a decir "Rehacer día"');

  // ===== La invariante: generar un dia NO pisa lo que ya hay =====
  // Se vacia el desayuno y se vuelve a pedir el dia: debe llenar SOLO esa casilla y dejar
  // el almuerzo intacto. Si el boton arrasara el dia (lo que hacia antes), el almuerzo
  // cambiaria de plato y la familia perderia lo que eligio a mano.
  console.log('\n=== plan.html: generar un dia respeta lo que ya hay ===');
  const almuerzoAntes = nombreCasilla(1);
  const planPrevio = await apiSrv(`/api/plan?semana=${SEMANA}`);
  await apiSrv(`/api/plan/${planPrevio.plan[1].desayuno.id}`, { method: 'DELETE' });
  doc2.defaultView.cargar(SEMANA);
  await esperar(1200);
  check(vaciasLunes() === 1, `el lunes quedo con 1 casilla vacia (= ${vaciasLunes()})`);
  check(/Generar día/.test(lunes().querySelector('[data-gen-dia]').textContent), 'y el boton vuelve a decir "Generar día"');

  lunes().querySelector('[data-gen-dia]').click();
  await esperar(400);
  for (let i = 0; i < 90 && vaciasLunes() === 1; i++) await esperar(1000);
  check(vaciasLunes() === 0, 'la IA lleno la casilla que faltaba');
  check(nombreCasilla(1) === almuerzoAntes,
    `y NO piso el almuerzo que ya estaba ("${almuerzoAntes}" -> "${nombreCasilla(1)}")`);

  // ===== Verificar un plato PROPUESTO por el usuario (fase 4) =====
  // La direccion inversa: el usuario escribe el plato y la IA le dice si le alcanza.
  // Se pide un plato con MANI a proposito: el hogar de prueba es alergico al mani, y lo
  // que se verifica aqui no es que la IA cocine bonito, sino que AVISE del alergeno en vez
  // de cambiar el plato en silencio. Si esto falla, es un fallo de seguridad, no de UX.
  console.log('\n=== plan.html: verificar un plato propuesto (real) ===');
  await vaciarSemana();
  const ver = await apiSrv('/api/plan/verificar', {
    method: 'POST',
    body: JSON.stringify({ semana: SEMANA, casillas: [{ dia: 3, momento: 'almuerzo', nombre: 'pollo con salsa de mani' }] }),
  });
  check(!!ver.verificados, `verifica el plato (${ver.mensaje || ver.error})`);

  const it = ver.plan?.[3]?.almuerzo;
  const cob = it?.cobertura;
  check(!!it, 'lo pone en la casilla pedida');
  check(it?.plato?.origen === 'propuesto', `el plato queda con origen='propuesto' (= ${it?.plato?.origen})`);
  check(!!cob, 'la casilla trae su cobertura');
  check(['alcanza', 'alcanza_justo', 'falta_comprar'].includes(cob?.veredicto), `veredicto valido (= ${cob?.veredicto})`);
  check(Array.isArray(cob?.tengo) && Array.isArray(cob?.faltantes), 'separa lo que tiene de lo que le falta');

  // Lo importante: el alergeno.
  // SIN TILDES antes de buscar: Gemini escribe "un alergeno grave para Luis" (con tilde en
  // la e) y Claude "¡ALERTA DE ALERGIA!" (sin tilde). Buscando /alerg/ a secas, el mismo
  // aviso —igual de correcto— pasaba con un proveedor y fallaba con el otro. Es exactamente
  // la trampa de "Gemini y Claude no responden igual": el aserto debe medir el CONTENIDO.
    const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const adv = sinTildes((cob?.advertencias || []).join(' ')).toLowerCase();
  check((cob?.advertencias || []).length > 0, `avisa de algo (${(cob?.advertencias || []).length} advertencia(s))`);
  check(/man[ií]/.test(adv), 'la advertencia nombra el MANI (el alergeno del hogar)');
  check(/alerg/.test(adv), 'y dice explicitamente que es una alergia');
  // La advertencia NO puede llegar cortada: el tope de 80 de los ingredientes la mutilaba
  // a media palabra ("...alergeno absoluto para L"). Ya paso.
  const larga = (cob?.advertencias || []).some((a) => a.length > 80);
  check(larga, `las advertencias no se truncan a 80 chars (la mas larga: ${Math.max(0, ...(cob?.advertencias || []).map((a) => a.length))} chars)`);
  check(!(cob?.advertencias || []).some((a) => a.length === 80), 'ninguna quedo exactamente en el tope (senal de recorte)');

  // El texto mal escrito se normaliza y el 422 avisa si no se reconoce.
  const raro = await apiSrv('/api/plan/verificar', {
    method: 'POST',
    body: JSON.stringify({ semana: SEMANA, casillas: [{ dia: 4, momento: 'cena', nombre: 'xkcd qwerty zzzz' }] }),
  });
  check(!raro.verificados, `un texto sin sentido no se inventa como plato (${raro.error || 'lo acepto <- falla'})`);

  // Limpieza: borrar la semana de prueba para no dejar basura. Y deshacer la copia a la
  // semana actual, si la hizo esta corrida: los platos son los MISMOS del menu de origen
  // (copiar no duplica), asi que vaciar las casillas no borra el menu sembrado.
  let copiaBorrada = 0;
  if (copiadaAqui) {
    const p = await apiSrv(`/api/plan?semana=${semanaActual}`);
    for (const d of p.dia_orden) for (const m of p.momentos) {
      const it = p.plan[d][m];
      if (it) { await apiSrv(`/api/plan/${it.id}`, { method: 'DELETE' }); copiaBorrada++; }
    }
  }
  console.log(`\n(limpieza: ${await vaciarSemana()} casillas de la semana de prueba eliminadas`
    + `${copiaBorrada ? `, ${copiaBorrada} de la copia en la semana actual` : ''})`);

  console.log(fallos ? `\n=== ${fallos} FALLA(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
