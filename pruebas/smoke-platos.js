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

  // La despensa es un módulo OPCIONAL que nace APAGADO, y esta prueba comprueba cosas que
  // dependen de ella (el botón de la despensa en el plan, la lista de compras, el descuento al
  // cocinar). Se enciende aquí, después de crear el usuario: fijar el estado, no heredarlo.
  const hogarPut = await (await fetch(`${BASE}/api/hogar`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ despensa_activa: true }),
  })).json();
  // El usuario que se guarda en localStorage para jsdom es el del REGISTRO, de antes de
  // encender la despensa. Se toma el que devuelve el PUT o la pagina se pintaria con la
  // bandera vieja (la app real lo resuelve refrescando en segundo plano, pero el test no
  // debe depender de esa carrera).
  Object.assign(usuario, hogarPut.usuario || {});

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

    // Lista de faltantes (Fase 5): responde con la forma correcta aun sin plan. El dedup
    // con datos reales se cubre en smoke:plan (necesita platos generados con faltantes).
    console.log('=== /api/plan/faltantes (forma) ===');
    const falt = await apiSrv('/api/plan/faltantes');
    check(falt.status === 200, `GET /faltantes responde 200 (fue ${falt.status})`);
    check(/^\d{4}-\d{2}-\d{2}$/.test(falt.cuerpo.inicio) && /^\d{4}-\d{2}-\d{2}$/.test(falt.cuerpo.fin), 'trae la ventana inicio/fin');
    check(Array.isArray(falt.cuerpo.items) && Array.isArray(falt.cuerpo.por_categoria), 'trae items[] y por_categoria[]');
    check(falt.cuerpo.total === 0, `usuario nuevo sin plan: 0 faltantes (fue ${falt.cuerpo.total})`);

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
    // "+ Nuevo plato" ya no abre el formulario: primero pregunta COMO quieres crearlo.
    // Son las mismas tres vias del calendario (a mano / escribo el nombre / que lo proponga
    // la IA), y las tres acaban guardando el plato en la biblioteca.
    p2.doc.getElementById('btn-nuevo').click();
    await esperar(200);
    const vias = [...p2.doc.querySelectorAll('[data-via]')];
    check(vias.length === 3, `ofrece las 3 vias para crear un plato (= ${vias.length})`);
    check(vias.map((v) => v.dataset.via).join(',') === 'manual,nombre,proponer',
      `en orden: manual, escribir el nombre, proponer (${vias.map((v) => v.dataset.via).join(', ')})`);
    check(/gastan una generación/i.test(txt(p2.doc, '.modal-body')),
      'y avisa que las dos con IA gastan cupo');

    // La via manual es la de siempre.
    vias.find((v) => v.dataset.via === 'manual').click();
    await esperar(200);
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

    // ===== Filtros y paginacion de la biblioteca =====
    //
    // Se siembran 15 platos DIRECTO EN LA BD (origen 'ia', que no cuenta contra platos_max) para
    // pasar de las 12 de una pagina. Crearlos por la API seria imposible: este usuario es Free.
    // Se van solos al borrar el usuario, por el CASCADE.
    console.log('\n=== filtros y paginacion ===');
    const sembrar = db.prepare(
      `INSERT INTO platos (usuario_id, nombre, momento, porciones, ingredientes, tiempo_min, dificultad, origen, guardado)
       VALUES (?, ?, ?, 2, '[]', ?, ?, 'ia', 1)`
    );
    const MOMS = ['desayuno', 'almuerzo', 'cena'];
    for (let i = 0; i < 15; i++) {
      sembrar.run(usuario.id, `Plato sembrado ${String(i + 1).padStart(2, '0')}`, MOMS[i % 3], 10 + i, i % 2 ? 'facil' : 'media');
    }

    const pg = await abrir('platos.html', token, usuario);
    check(pg.errores.length === 0, `sin errores de runtime ${pg.errores.join(' | ')}`);

    const enPantalla = () => pg.doc.querySelectorAll('#lista .result-section').length;
    const total = (await apiSrv('/api/platos')).cuerpo.total;
    check(total === 20, `la biblioteca tiene 20 platos (= ${total})`);
    check(enPantalla() === 12, `la primera pagina muestra 12, no los 20 (= ${enPantalla()})`);
    check(txt(pg.doc, '#cont').includes('1-12 de 20'), `el contador dice cuales estas viendo: "${txt(pg.doc, '#cont')}"`);
    check(!pg.doc.getElementById('paginacion').hidden, 'la paginacion se muestra');
    check(txt(pg.doc, '#pag-txt') === 'Página 1 de 2', `"${txt(pg.doc, '#pag-txt')}"`);
    check(pg.doc.getElementById('pag-antes').disabled, 'en la primera pagina, "Anterior" esta deshabilitado');

    const idsPag1 = [...pg.doc.querySelectorAll('#lista [data-ver]')].map((b) => b.dataset.ver);
    pg.doc.getElementById('pag-sigue').click();
    await esperar(500);
    check(txt(pg.doc, '#pag-txt') === 'Página 2 de 2', 'pasa a la pagina 2');
    check(enPantalla() === 8, `quedan 8 en la ultima pagina (= ${enPantalla()})`);
    check(pg.doc.getElementById('pag-sigue').disabled, 'en la ultima, "Siguiente" esta deshabilitado');
    const idsPag2 = [...pg.doc.querySelectorAll('#lista [data-ver]')].map((b) => b.dataset.ver);
    // creado_en tiene precision de SEGUNDOS y estos 15 platos nacen en el mismo: sin el
    // desempate por id en el ORDER BY, un plato saldria en las dos paginas y otro en ninguna.
    check(idsPag1.every((id) => !idsPag2.includes(id)), 'ningun plato se repite entre las dos paginas');
    check(new Set([...idsPag1, ...idsPag2]).size === 20, 'entre las dos paginas estan los 20');

    // Filtrar vuelve a la pagina 1: seguir en la 2 dejaria la lista vacia con resultados.
    pg.doc.getElementById('filtro-momento').value = 'desayuno';
    pg.doc.getElementById('filtro-momento').dispatchEvent(new pg.win.Event('change'));
    await esperar(500);
    const desayunos = (await apiSrv('/api/platos?momento=desayuno')).cuerpo.total;
    check(enPantalla() === Math.min(12, desayunos), `filtra por momento (${enPantalla()} en pantalla de ${desayunos})`);
    check(pg.doc.getElementById('paginacion').hidden, 'con una sola pagina, la paginacion desaparece');
    check(!pg.doc.getElementById('btn-limpiar').hidden, 'aparece "Quitar filtros"');

    // Un filtro sin resultados NO debe decir "todavia no guardas ningun plato".
    pg.doc.getElementById('buscar').value = 'zzz-no-existe';
    pg.doc.getElementById('buscar').dispatchEvent(new pg.win.Event('input'));
    await esperar(700);
    check(enPantalla() === 0, 'sin coincidencias no pinta tarjetas');
    check(/coincide con lo que buscas/i.test(txt(pg.doc, '#lista')),
      `distingue "sin resultados" de "sin platos": "${txt(pg.doc, '#lista').slice(0, 60)}"`);

    pg.doc.getElementById('btn-limpiar').click();
    await esperar(500);
    check(enPantalla() === 12, `quitar los filtros devuelve la lista entera (= ${enPantalla()})`);
    check(pg.doc.getElementById('btn-limpiar').hidden, 'y el boton de quitar filtros se esconde');

    // Los filtros nuevos, contra el servidor.
    const soloMios = (await apiSrv('/api/platos?origen=mio')).cuerpo;
    check(soloMios.platos.every((p) => p.origen === 'manual'), `"solo los tuyos" trae ${soloMios.total} manuales`);
    const soloIA = (await apiSrv('/api/platos?origen=ia')).cuerpo;
    check(soloIA.platos.every((p) => p.origen !== 'manual') && soloIA.total === 15,
      `"solo los de la IA" trae los 15 sembrados (= ${soloIA.total})`);
    check(soloMios.total + soloIA.total === total, 'los dos origenes suman el total (no se pierde ninguno)');
    const sinUsar = (await apiSrv('/api/platos?uso=sin_usar')).cuerpo;
    check(sinUsar.total === total, `"nunca los usaste" trae todos, que aun no estan en el plan (= ${sinUsar.total})`);
    const porNombre = (await apiSrv('/api/platos?orden=nombre')).cuerpo.platos.map((p) => p.nombre);
    const ordenados = [...porNombre].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    check(porNombre.join('|') === ordenados.join('|'), 'el orden alfabetico llega ordenado del servidor');
    const rapidos = (await apiSrv('/api/platos?orden=tiempo')).cuerpo.platos.map((p) => p.tiempo_min).filter((t) => t != null);
    check(rapidos.every((t, i) => i === 0 || rapidos[i - 1] <= t), `el orden por tiempo va de menor a mayor (${rapidos.slice(0, 4).join(', ')}…)`);
    check(soloIA.resumen.total === total && soloIA.resumen.ia === 15,
      'el resumen cuenta la biblioteca ENTERA, no la pagina filtrada');

    // Sin paginar sigue devolviendo todo: el selector de platos del calendario llama asi.
    const todos = (await apiSrv('/api/platos')).cuerpo;
    check(todos.platos.length === 20 && todos.por_pagina === null,
      `sin pedir paginacion vienen los 20 (= ${todos.platos.length})`);

    // Se quitan los sembrados para que las secciones siguientes vean la biblioteca de antes.
    db.prepare("DELETE FROM platos WHERE usuario_id = ? AND nombre LIKE 'Plato sembrado %'").run(usuario.id);

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

    // La avena entra a la despensa LLENA: es el ingrediente del plato de desayuno, y sobre
    // ella se comprueba el descuento al cocinar (mas abajo). Sin IA: el plato es manual, no
    // trae "consume", asi que el consumo sale de la heuristica por categoria (PESO_CATEGORIA).
    await apiSrv('/api/despensa', { method: 'POST', body: JSON.stringify({ nombre: 'Avena', categoria: 'abarrote', porcentaje: 100 }) });

    const pl = await abrir('plan.html', token, usuario);
    await esperar(500);
    check(pl.errores.length === 0, `sin errores de runtime ${pl.errores.join(' | ')}`);
    check(pl.doc.querySelectorAll('.casilla.vacia').length === 21, 'el calendario del usuario nuevo esta vacio');
    // La lista de compras no se ofrece con la semana vacia: no hay platos de los que sacar
    // faltantes, y el boton devolvia una lista vacia que parecia un error.
    check(pl.doc.querySelector('#btn-faltantes').classList.contains('hidden'), 'con la semana vacia NO se ofrece la lista de compras');
    // "Ver mi despensa" abre la despensa con la ventana de la semana visible. Es el puente que
    // faltaba entre las dos pantallas: sin el, la despensa siempre proyectaba la semana actual.
    // Va SIEMPRE visible (a diferencia de la lista de compras): ver tu stock tiene sentido
    // aunque la semana este vacia.
    const btnDesp = pl.doc.querySelector('#btn-despensa');
    check(!!btnDesp && !btnDesp.classList.contains('hidden'), 'el plan ofrece "Ver mi despensa" (tambien con la semana vacia)');

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
    check(!pl.doc.querySelector('#btn-faltantes').classList.contains('hidden'), 'con la semana ya programada SI se ofrece la lista de compras');

    // ===== Consumo de la despensa =====
    // Mientras el plato solo esta PROGRAMADO, la despensa no se toca: lo que se ve es una
    // proyeccion. El descuento real ocurre al marcar la comida como cocinada, y desmarcar
    // lo devuelve EXACTO (lo que se resto de verdad, no lo que se volveria a estimar hoy).
    // El numero esperado NO se fija a mano: sale del propio PESO_CATEGORIA dividido por las
    // semanas del periodo, que es la formula real (ver services/consumo.js). Estuvo escrito
    // como "12 => 88%" y solo seguia pasando de casualidad tras recalibrar los pesos: un
    // hardcode aqui convierte un cambio de escala deliberado en un fallo misterioso.
    const { PESO_CATEGORIA, semanasDelPeriodo } = require('../src/services/consumo');
    const esperado = Math.round(PESO_CATEGORIA.abarrote / semanasDelPeriodo(usuario.id));

    const avena = async () => (await apiSrv('/api/despensa')).cuerpo.despensa.find((i) => i.nombre === 'Avena');
    const programada = await avena();
    check(programada.porcentaje === 100, `programar NO descuenta de la despensa (sigue en ${programada.porcentaje}%)`);
    check(programada.consumo_previsto === esperado && programada.restante === 100 - esperado,
      `pero se proyecta el consumo: -${programada.consumo_previsto} => quedaria ${programada.restante}% (esperado -${esperado})`);

    casillaLunes().querySelector('[data-cocinado]').click();
    await esperar(800);
    const cocinada = await avena();
    check(cocinada.porcentaje === 100 - esperado, `al marcar cocinado SI se descuenta (100% -> ${cocinada.porcentaje}%)`);
    check(cocinada.consumo_previsto === 0, 'y deja de proyectarse (no se cuenta dos veces)');
    check(cocinada.nivel === 'bastante', `el nivel derivado se recalcula: "${cocinada.nivel}"`);

    casillaLunes().querySelector('[data-cocinado]').click();
    await esperar(800);
    const revertida = await avena();
    check(revertida.porcentaje === 100, `desmarcar devuelve lo descontado (-> ${revertida.porcentaje}%)`);

    // El plato manual TRAE pasos: el detalle debe mostrarlos en vez del aviso de "aun no".
    casillaLunes().querySelector('[data-ver]').click();
    await esperar(250);
    const detalle = (pl.doc.querySelector('.modal-back')?.textContent || '').replace(/\s+/g, ' ');
    check(/Cómo prepararlo/.test(detalle), 'el detalle muestra los pasos de un plato que si los tiene');
    check(/Hervir la leche/.test(detalle), 'y son los pasos reales del plato');
    check(!/próxima versión/.test(detalle), 'sin el aviso de "llega en la proxima version" para ese plato');

    // ===== Explicacion de cada nutriente =====
    //
    // Va AL FINAL a proposito: necesita un integrante con una condicion medica, y crear uno deja
    // el hogar "configurado", que es justo lo contrario de lo que comprueba la seccion anterior
    // ("sin hogar, Proponer esta deshabilitado").
    console.log('\n=== explicacion de los nutrientes ===');
    await apiSrv('/api/hogar/integrantes', {
      method: 'POST',
      body: JSON.stringify({ nombre: 'Abuela Rosa', edad: 70, condiciones: ['hipertension'] }),
    });

    const nt = await abrir('plan.html', token, usuario);
    check(nt.errores.length === 0, `sin errores de runtime ${nt.errores.join(' | ')}`);

    // Las instrucciones ahora van ARRIBA DE TODO, antes del selector de fechas.
    const cards = [...nt.doc.querySelectorAll('.content > .card')];
    const iInstr = cards.findIndex((c) => c.classList.contains('instrucciones'));
    const iSelector = cards.findIndex((c) => c.querySelector('#lbl-semana'));
    check(iInstr >= 0 && iInstr < iSelector, `las instrucciones van antes del selector de fechas (${iInstr} < ${iSelector})`);
    check(/Instrucciones/.test(nt.doc.querySelector('.instrucciones h3')?.textContent || ''), 'con el titulo "Instrucciones"');
    check((nt.doc.querySelectorAll('.instrucciones .pasos-plan li') || []).length === 3, 'y sus 3 pasos');

    // Se pinta el bloque nutricional de un plato de prueba y se toca una fila.
    const caja = nt.doc.createElement('div');
    caja.innerHTML = nt.win.bloqueNutri({
      calorias: 480, calorias_vd: 24, semaforo: 'ambar', resumen: 'Plato de prueba',
      nutrientes: {
        carbohidratos: { v: 60, vd: 20 }, proteinas: { v: 25, vd: 50 }, grasas: { v: 12, vd: 15 },
        fibra: { v: 3, vd: 12 }, hierro: { v: 2, vd: 11 }, sodio: { v: 900, vd: 39 }, sal: { v: 2.3, vd: 46 },
      },
    });
    nt.doc.body.appendChild(caja);
    const botones = caja.querySelectorAll('[data-nutri]');
    check(botones.length === 8, `cada nutriente trae su boton de explicacion (= ${botones.length}, con la energia)`);

    const bSodio = [...botones].find((b) => b.dataset.nutri === 'sodio');
    bSodio.click();
    await esperar(200);
    const expl = [...nt.doc.querySelectorAll('.modal-back')].pop();
    const t = (expl?.textContent || '').replace(/\s+/g, ' ');
    check(/Sodio/.test(t), 'el modal explica el nutriente que se toco');
    check(/900 mg/.test(t) && /39%/.test(t), `repite el numero del plato: "${(t.match(/[\d.]+ mg[^]{0,28}/) || [''])[0].trim()}"`);
    check(/sal|cubito|sillao/i.test(t), 'dice de donde viene el sodio en la comida real');
    check(/presión|presion/i.test(t), 'y que pasa si hay de mas');
    check(/Aporte alto/.test(t), 'lee el 39% como aporte ALTO (regla del 5 y el 20)');
    check(/Abuela Rosa/.test(t), 'nombra a quien de la familia le importa (hipertension)');
    check(/no reemplaza/i.test(t), 'y mantiene el aviso de que no reemplaza al profesional');
    expl.querySelector('[data-cerrar]').click();

    // El mismo % se lee distinto segun el nutriente: 50% de proteina es una BUENA noticia.
    [...botones].find((b) => b.dataset.nutri === 'proteinas').click();
    await esperar(200);
    const tProt = ([...nt.doc.querySelectorAll('.modal-back')].pop()?.textContent || '').replace(/\s+/g, ' ');
    check(/Aporte alto/.test(tProt) && /[Bb]uena noticia/.test(tProt),
      'un aporte alto de proteina se lee como algo bueno, no como una advertencia');
    check(!/Abuela Rosa/.test(tProt), 'y no le cuelga a la abuela un aviso que no le toca');
    [...nt.doc.querySelectorAll('.modal-back')].pop().querySelector('[data-cerrar]').click();

    nt.win.close();

    win.close();
    p2.win.close();
    pl.win.close();
  } finally {
    limpiar();
  }

  console.log(fallos ? `\n=== ${fallos} FALLO(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
