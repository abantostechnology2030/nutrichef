// Smoke test de platos.html (la biblioteca) + /api/platos: carga la pagina en un DOM
// real (jsdom) contra el servidor de verdad en :3002 y reporta errores de runtime.
// Ejercita: listado, crear plato manual, buscador, editar, borrar y el tope del plan.
// Ver pruebas/README.md.
//
// No usa IA: es gratis y rapido.
//
// El test crea SU PROPIO usuario y lo borra al terminar. No usa fam@test.pe porque su
// plan es estado mutable (aprobarle un pago Yape lo pasa a Premium = ilimitado) y el
// tope de platos dejaria de verificarse en silencio.
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const db = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))(
  path.join(__dirname, '..', 'nutrichefia.db')
);

const BASE = 'http://localhost:3002';
const EMAIL = `smoke-platos-${Date.now()}@test.pe`;
const PASS = 'prueba123';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrir(pagina, token, usuario) {
  const errores = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errores.push('jsdomError: ' + (e.detail?.message || e.message)));
  vc.on('error', (...a) => errores.push('console.error: ' + a.join(' ')));

  const html = await (await fetch(`${BASE}/${pagina}`)).text();
  const dom = new JSDOM(html, {
    url: `${BASE}/${pagina}`,
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole: vc,
    beforeParse(win) {
      win.localStorage.setItem('nutrichefia_token', token);
      win.localStorage.setItem('nutrichefia_user', JSON.stringify(usuario));
      win.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
      // NO tocar navigator.serviceWorker (ver nota en smoke-hogar-despensa.js).
    },
  });

  await esperar(1200);
  return { dom, win: dom.window, doc: dom.window.document, errores };
}

const txt = (doc, sel) => (doc.querySelector(sel)?.textContent || '').trim().replace(/\s+/g, ' ');

(async () => {
  let fallos = 0;
  const check = (cond, msg) => { console.log((cond ? '  OK   ' : '  FALLA ') + msg); if (!cond) fallos++; };

  // ===== Usuario propio (nace en el plan Free) =====
  const reg = await (await fetch(`${BASE}/api/auth/registro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Smoke Platos', email: EMAIL, password: PASS }),
  })).json();
  const { token, usuario } = reg;

  const apiSrv = async (ruta, opts = {}) => {
    const r = await fetch(BASE + ruta, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
  };

  const limpiar = () => {
    const r = db.prepare('DELETE FROM usuarios WHERE email = ?').run(EMAIL);
    console.log(`\n(limpieza: usuario de prueba borrado -> ${r.changes} fila; sus platos se van por CASCADE)`);
  };

  try {
    // ===== API =====
    console.log('=== /api/platos ===');
    const vacia = await apiSrv('/api/platos');
    check(vacia.status === 200, `GET responde 200 (fue ${vacia.status})`);
    check(vacia.cuerpo.platos.length === 0, 'la biblioteca de un usuario nuevo esta vacia');
    check(vacia.cuerpo.limite.max === 5, `el plan Free topa en 5 platos (fue ${vacia.cuerpo.limite.max})`);

    const creado = await apiSrv('/api/platos', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Aji de gallina de prueba',
        momento: 'almuerzo',
        porciones: 4,
        tiempo_min: 45,
        dificultad: 'media',
        ingredientes: [{ nombre: 'Pollo', cantidad: '500', unidad: 'g' }, { nombre: '', cantidad: '1' }],
        pasos: ['Sancochar el pollo', '   ', 'Deshilachar'],
        nota: 'sin sal para la hipertension',
      }),
    });
    check(creado.status === 201, `POST crea el plato (fue ${creado.status})`);
    check(creado.cuerpo.plato?.origen === 'manual', 'nace con origen = manual');
    check(creado.cuerpo.plato?.guardado === true, 'nace en la biblioteca (guardado = 1)');
    check(creado.cuerpo.plato?.ingredientes.length === 1, 'el ingrediente sin nombre se descarta');
    check(creado.cuerpo.plato?.pasos?.length === 2, 'el paso en blanco se descarta');

    const sinNombre = await apiSrv('/api/platos', { method: 'POST', body: JSON.stringify({ momento: 'cena' }) });
    check(sinNombre.status === 400, `POST sin nombre da 400 (fue ${sinNombre.status})`);

    // ===== Tope del plan =====
    console.log('\n=== tope del plan (platos_max = 5) ===');
    for (let i = 0; i < 4; i++) {
      await apiSrv('/api/platos', { method: 'POST', body: JSON.stringify({ nombre: `Relleno ${i}` }) });
    }
    const pasado = await apiSrv('/api/platos', { method: 'POST', body: JSON.stringify({ nombre: 'Uno de mas' }) });
    check(pasado.status === 403, `el plato 6 se rechaza con 403 (fue ${pasado.status})`);
    check(pasado.cuerpo.upgrade === true, 'el 403 trae la bandera upgrade (dispara el paywall)');

    // ===== Pagina =====
    console.log('\n=== platos.html ===');
    const { doc, errores, win } = await abrir('platos.html', token, usuario);
    check(errores.length === 0, `sin errores de runtime ${errores.join(' | ')}`);

    const tarjetas = doc.querySelectorAll('#lista .result-section');
    check(tarjetas.length === 5, `pinta los 5 platos guardados (= ${tarjetas.length})`);
    check(txt(doc, '#pill-platos').includes('5 de 5'), `la pill muestra el tope: "${txt(doc, '#pill-platos')}"`);
    check(doc.querySelector('#filtro-momento').options.length === 4, 'el filtro trae 3 momentos + "todos"');
    check(txt(doc, '#lista').includes('Aji de gallina de prueba'), 'el plato creado aparece en la lista');

    // El boton "+ Nuevo plato" con la biblioteca llena avisa en vez de abrir el formulario.
    doc.getElementById('btn-nuevo').click();
    await esperar(150);
    const modal = doc.querySelector('.modal-back .modal');
    check(!!modal && txt(doc, '.modal h3').includes('llena'), 'con el tope lleno avisa en vez de abrir el form');
    doc.querySelector('.modal-back [data-no]')?.click();

    // Con espacio libre, el formulario si se abre.
    const suyos = (await apiSrv('/api/platos')).cuerpo.platos;
    await apiSrv(`/api/platos/${suyos[0].id}`, { method: 'DELETE' });
    const p2 = await abrir('platos.html', token, usuario);
    check(p2.errores.length === 0, `sin errores tras borrar ${p2.errores.join(' | ')}`);
    check(p2.doc.querySelectorAll('#lista .result-section').length === 4, 'quedan 4 tras borrar uno');
    p2.doc.getElementById('btn-nuevo').click();
    await esperar(150);
    check(txt(p2.doc, '.modal h3') === 'Nuevo plato', `el formulario se abre (titulo: "${txt(p2.doc, '.modal h3')}")`);
    check(p2.doc.querySelectorAll('.modal [data-fila]').length === 2, 'el form arranca con 2 filas de ingrediente');
    p2.doc.querySelector('.modal #f-add-ing').click();
    check(p2.doc.querySelectorAll('.modal [data-fila]').length === 3, 'se puede agregar otra fila');
    p2.doc.querySelector('.modal [data-fila] [data-quitar]').click();
    check(p2.doc.querySelectorAll('.modal [data-fila]').length === 2, 'se puede quitar una fila');

    // Crear desde la UI de verdad.
    p2.doc.querySelector('.modal #f-nombre').value = 'Creado desde la pagina';
    p2.doc.querySelector('.modal #f-porciones').value = '3';
    const filas = p2.doc.querySelectorAll('.modal [data-fila]');
    filas[0].querySelector('[data-i-nombre]').value = 'Papa';
    filas[0].querySelector('[data-i-cant]').value = '1';
    filas[0].querySelector('[data-i-uni]').value = 'kg';
    p2.doc.querySelector('.modal [data-guardar]').click();
    await esperar(700);
    const trasCrear = (await apiSrv('/api/platos')).cuerpo.platos;
    check(trasCrear.some((x) => x.nombre === 'Creado desde la pagina'), 'el formulario crea el plato de verdad');
    const nuevo = trasCrear.find((x) => x.nombre === 'Creado desde la pagina');
    check(nuevo?.porciones === 3, `guarda las porciones (fue ${nuevo?.porciones})`);
    check(nuevo?.ingredientes[0]?.nombre === 'Papa', 'guarda el ingrediente escrito en el form');

    // ===== plan.html: cargar un plato de la biblioteca en una casilla =====
    // La 2a via para llenar el calendario (la 1a es la IA). Se prueba aqui y no en
    // smoke-plan.js porque NO usa IA: asi la prueba es gratis y se corre siempre.
    console.log('\n=== plan.html: cargar un plato desde "Mis platos" ===');
    // Estado FIJADO a proposito: esta seccion no hereda la biblioteca de las pruebas de
    // arriba. Aquella borra `platos[0]` ordenando por creado_en DESC, pero creado_en tiene
    // precision de SEGUNDOS y todos los platos del test nacen en el mismo segundo: el
    // desempate es arbitrario y el plato borrado cambia entre corridas. Heredarlo daba un
    // falso OK ("un plato de almuerzo no se ofrece" pasaba porque no habia ninguno).
    for (const p of (await apiSrv('/api/platos')).cuerpo.platos) {
      await apiSrv(`/api/platos/${p.id}`, { method: 'DELETE' });
    }
    await apiSrv('/api/platos', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Solo para desayuno', momento: 'desayuno', porciones: 2,
        ingredientes: [{ nombre: 'Avena', cantidad: '1', unidad: 'taza' }],
        pasos: ['Hervir la leche', 'Agregar la avena'],
      }),
    });
    await apiSrv('/api/platos', { method: 'POST', body: JSON.stringify({ nombre: 'Solo para almuerzo', momento: 'almuerzo' }) });
    await apiSrv('/api/platos', { method: 'POST', body: JSON.stringify({ nombre: 'Sin momento fijo' }) });

    const pl = await abrir('plan.html', token, usuario);
    await esperar(500);
    check(pl.errores.length === 0, `sin errores de runtime ${pl.errores.join(' | ')}`);
    check(pl.doc.querySelectorAll('.casilla.vacia').length === 21, 'el calendario del usuario nuevo esta vacio');

    // Este usuario no tiene hogar: la IA no puede proponer nada (el backend daria 409),
    // pero poner un plato PROPIO no la necesita. Los dos botones no se bloquean igual.
    const casillaLunes = () => pl.doc.querySelector('.dia-fila:first-child .casilla');
    check(casillaLunes().querySelector('[data-gen]').disabled === true, 'sin hogar, "Proponer" (IA) esta deshabilitado');
    check(casillaLunes().querySelector('[data-lib]').disabled === false, 'pero "Mis platos" sigue disponible (no usa IA)');

    casillaLunes().querySelector('[data-lib]').click();
    await esperar(600);
    const opciones = () => [...pl.doc.querySelectorAll('#lib-lista [data-plato]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    check(opciones().length === 2, `para el desayuno ofrece 2 de los 3 platos (= ${opciones().length})`);
    check(!opciones().some((t) => t.includes('Solo para almuerzo')), 'un plato de ALMUERZO no se ofrece para el desayuno');
    check(opciones().some((t) => t.includes('Sin momento fijo')), 'los platos sin momento si (encajan en cualquier casilla)');
    // ...salvo que se pidan todos.
    pl.doc.querySelector('#lib-todos').click();
    await esperar(150);
    check(opciones().length === 3, `con "Ver todos" aparecen los 3 (= ${opciones().length})`);
    check(opciones().some((t) => t.includes('Solo para almuerzo')), 'incluido el de almuerzo');

    const btnPlato = [...pl.doc.querySelectorAll('#lib-lista [data-plato]')].find((b) => b.textContent.includes('Solo para desayuno'));
    check(!!btnPlato, 'el plato de desayuno esta en el selector');
    btnPlato.click();
    await esperar(900);
    check(!pl.doc.querySelector('.modal-back'), 'el selector se cierra al elegir');
    check(!casillaLunes().classList.contains('vacia'), 'la casilla deja de estar vacia');
    check(casillaLunes().textContent.includes('Solo para desayuno'), 'y muestra el plato elegido');
    check(pl.doc.querySelectorAll('.casilla.vacia').length === 20, 'solo se lleno esa casilla (no toco el resto)');
    const enServidor = (await apiSrv('/api/plan')).cuerpo;
    check(enServidor.plan?.[1]?.desayuno?.plato?.nombre === 'Solo para desayuno', 'y quedo guardado en el servidor, no solo en pantalla');

    // El plato manual TRAE pasos: el detalle debe mostrarlos en vez del aviso de "aun no".
    casillaLunes().querySelector('[data-ver]').click();
    await esperar(250);
    const detalle = (pl.doc.querySelector('.modal-back')?.textContent || '').replace(/\s+/g, ' ');
    check(/Cómo prepararlo/.test(detalle), 'el detalle muestra los pasos de un plato que si los tiene');
    check(/Hervir la leche/.test(detalle), 'y son los pasos reales del plato');
    check(!/próxima versión/.test(detalle), 'sin el aviso de "llega en la proxima version" para ese plato');

    win.close();
    p2.win.close();
    pl.win.close();
  } finally {
    limpiar();
  }

  console.log(fallos ? `\n=== ${fallos} FALLO(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
