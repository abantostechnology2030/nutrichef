// Smoke test de hogar.html y despensa.html: las carga en un DOM real (jsdom), contra
// el servidor de verdad en :3002, y reporta cualquier error de runtime.
// Ejercita: carga inicial, chips de condiciones/alergias, guardar integrante,
// agregar ingrediente, tab de compra, seleccion y filtro del catalogo.
// Ver pruebas/README.md.
//
// No usa IA: es gratis y rapido. DEJA el hogar de prueba en un estado conocido
// (Casa Abanto + Rosa/Luis/Ana) porque el test necesita conteos estables.
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://localhost:3002';
const EMAIL = 'fam@test.pe';
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
      // Sesion ya iniciada.
      win.localStorage.setItem('nutrichefia_token', token);
      win.localStorage.setItem('nutrichefia_user', JSON.stringify(usuario));
      // jsdom no trae fetch: se lo damos (resolviendo rutas relativas contra el server).
      win.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
      // NO tocar navigator.serviceWorker: jsdom no lo trae y api.js ya lo protege con
      // ('serviceWorker' in navigator). Asignarle undefined haria pasar ese guard y
      // romper la pagina — un fallo del test, no de la app.
    },
  });

  await esperar(1200); // deja correr la carga inicial (api() es async)
  return { dom, win: dom.window, doc: dom.window.document, errores };
}

const txt = (doc, sel) => (doc.querySelector(sel)?.textContent || '').trim().replace(/\s+/g, ' ');

(async () => {
  const login = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })).json();
  const { token, usuario } = login;

  let fallos = 0;
  const check = (cond, msg) => { console.log((cond ? '  OK   ' : '  FALLA ') + msg); if (!cond) fallos++; };

  // El test debe poder correr N veces con el mismo resultado: se deja el hogar en un
  // estado conocido antes de empezar (si no, los integrantes de la corrida anterior
  // desplazan todos los conteos).
  const apiSrv = (ruta, opts = {}) => fetch(BASE + ruta, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }).then((r) => r.json());

  const previo = await apiSrv('/api/hogar');
  for (const i of previo.integrantes) await apiSrv(`/api/hogar/integrantes/${i.id}`, { method: 'DELETE' });
  await apiSrv('/api/hogar', { method: 'PUT', body: JSON.stringify({ nombre: 'Casa Abanto', region: 'sierra', ciudad: 'Cusco', dieta: 'omnivora', presupuesto: 'medio' }) });
  for (const it of [
    { nombre: 'Rosa', edad: 58, condiciones: ['diabetes', 'hipertension'], alergias: [] },
    { nombre: 'Luis', edad: 12, condiciones: [], alergias: ['mani', 'mariscos'] },
    { nombre: 'Ana', edad: 34, condiciones: ['intolerancia a la lactosa'], alergias: [] },
  ]) await apiSrv('/api/hogar/integrantes', { method: 'POST', body: JSON.stringify(it) });

  // Ingrediente unico por corrida, para que "agregar" siempre sea un alta real
  // (el dedup de la despensa es correcto, pero haria que el conteo no cambie).
  const INGREDIENTE = 'Hierba de prueba ' + Date.now();

  // ================= HOGAR =================
  console.log('\n=== hogar.html ===');
  {
    const { doc, win, errores } = await abrir('hogar.html', token, usuario);
    check(errores.length === 0, `sin errores de runtime ${errores.length ? '-> ' + errores.join(' | ') : ''}`);
    check(doc.querySelectorAll('#sidebar a').length > 0, `sidebar pintado (${doc.querySelectorAll('#sidebar a').length} items)`);
    check(doc.querySelector('#h-region')?.options.length === 3, 'select de region con 3 opciones');
    check(doc.querySelector('#h-region')?.value === 'sierra', `region cargada de la BD (= ${doc.querySelector('#h-region')?.value})`);
    check(doc.querySelector('#h-ciudad')?.value === 'Cusco', `ciudad cargada (= ${doc.querySelector('#h-ciudad')?.value})`);
    check(txt(doc, '#h-comensales') !== null && doc.querySelector('#h-comensales').value === '3 personas',
      `comensales derivado (= "${doc.querySelector('#h-comensales').value}")`);
    check(doc.querySelector('#aviso-config').classList.contains('hidden'), 'aviso de onboarding oculto (hogar ya configurado)');
    const tarjetas = doc.querySelectorAll('#lista-integrantes .card');
    check(tarjetas.length === 3, `3 integrantes pintados (= ${tarjetas.length})`);
    const rosa = [...tarjetas].map((c) => c.textContent).find((t) => t.includes('Rosa')) || '';
    check(rosa.includes('diabetes') && rosa.includes('hipertension'), 'Rosa muestra sus condiciones');
    const luis = [...tarjetas].map((c) => c.textContent).find((t) => t.includes('Luis')) || '';
    check(luis.includes('mani') && luis.includes('mariscos'), 'Luis muestra sus alergias');

    // Abrir el formulario y comprobar los chips de sugerencias.
    doc.querySelector('#btn-nuevo-int').click();
    await esperar(120);
    check(!doc.querySelector('#form-int').classList.contains('hidden'), 'el formulario de integrante se abre');
    check(doc.querySelectorAll('#chips-cond [data-chip]').length === 16, `16 chips de condiciones (= ${doc.querySelectorAll('#chips-cond [data-chip]').length})`);
    check(doc.querySelectorAll('#chips-alerg [data-chip]').length === 10, `10 chips de alergias (= ${doc.querySelectorAll('#chips-alerg [data-chip]').length})`);

    // Toggle de un chip.
    const chip = doc.querySelector('#chips-cond [data-chip="diabetes"]');
    chip.click(); await esperar(80);
    check(doc.querySelector('#chips-cond [data-chip="diabetes"]').textContent.includes('✓'), 'el chip se marca al hacer clic');

    // Condicion escrita a mano (fuera de las sugerencias).
    doc.querySelector('#i-cond-otra').value = 'condicion inventada';
    doc.querySelector('#btn-cond-otra').click(); await esperar(80);
    check(doc.querySelectorAll('#chips-cond [data-chip]').length === 17, 'una condicion propia se agrega como chip');

    // Guardar un integrante nuevo de verdad.
    doc.querySelector('#i-nombre').value = 'Pedro';
    doc.querySelector('#i-edad').value = '70';
    doc.querySelector('#btn-guardar-int').click();
    await esperar(900);
    check(doc.querySelectorAll('#lista-integrantes .card').length === 4, `se guardo y la lista pasa a 4 (= ${doc.querySelectorAll('#lista-integrantes .card').length})`);
    check(doc.querySelector('#h-comensales').value === '4 personas', `comensales se recalcula a 4 (= "${doc.querySelector('#h-comensales').value}")`);
    check(JSON.parse(win.localStorage.getItem('nutrichefia_user')).hogar_configurado === true, 'la sesion local queda sincronizada');
  }

  // ================= DESPENSA =================
  console.log('\n=== despensa.html ===');
  {
    const { doc, errores } = await abrir('despensa.html', token, usuario);
    check(errores.length === 0, `sin errores de runtime ${errores.length ? '-> ' + errores.join(' | ') : ''}`);
    check(doc.querySelector('#lista-catalogo').children.length === 51, `datalist con 51 ingredientes (= ${doc.querySelector('#lista-catalogo').children.length})`);
    check(doc.querySelector('#d-nivel').options.length === 3, 'select de nivel con 3 opciones');
    check(doc.querySelector('#d-cat').options.length === 11, `select de categoria con 11 opciones (= ${doc.querySelector('#d-cat').options.length})`);
    check(doc.querySelector('#filtro-cat').options.length === 12, `filtro con 11 categorias + "todas" (= ${doc.querySelector('#filtro-cat').options.length})`);
    check(/\d+ en despensa/.test(txt(doc, '#pill-despensa')), `pill de despensa: "${txt(doc, '#pill-despensa')}"`);
    const antes = doc.querySelectorAll('#lista-despensa [data-del]').length;
    check(antes > 0, `${antes} ingredientes pintados`);
    check(doc.querySelectorAll('#lista-despensa .cat-chip').length > 0, 'los ingredientes salen agrupados por categoria');

    // Agregar un ingrediente de verdad.
    doc.querySelector('#d-nombre').value = INGREDIENTE;
    doc.querySelector('#btn-add-ing').click();
    await esperar(900);
    const despues = doc.querySelectorAll('#lista-despensa [data-del]').length;
    check(despues === antes + 1, `agregar ingrediente: ${antes} -> ${despues}`);

    // Tab de compra. El ingrediente recien agregado queda PRESELECCIONADO aqui (queda
    // listo para registrarlo como compra de la semana), asi que el boton ya esta habilitado.
    doc.querySelector('#t-compra').click(); await esperar(600);
    check(!doc.querySelector('#panel-compra').classList.contains('hidden'), 'la tab de compra se muestra');
    check(doc.querySelectorAll('#catalogo-chips [data-cat-chip]').length === 51, `chips del catalogo (= ${doc.querySelectorAll('#catalogo-chips [data-cat-chip]').length})`);
    check(doc.querySelector('#btn-guardar-compra').disabled === false, 'el ingrediente agregado llega preseleccionado (boton habilitado)');
    check(txt(doc, '#c-resumen').includes('1 ingrediente'), `resumen arranca con el agregado: "${txt(doc, '#c-resumen')}"`);
    check(doc.querySelectorAll('#lista-seleccion [data-sel-del]').length === 1, 'el agregado se lista para registrar');

    // Seleccionar 2 chips mas -> 3 en total.
    const chips = doc.querySelectorAll('#catalogo-chips [data-cat-chip]');
    chips[0].click(); await esperar(60);
    chips[5].click(); await esperar(60);
    check(doc.querySelector('#btn-guardar-compra').disabled === false, 'el boton sigue habilitado al seleccionar mas');
    check(txt(doc, '#c-resumen').includes('3 ingredientes'), `resumen: "${txt(doc, '#c-resumen')}"`);
    check(doc.querySelectorAll('#lista-seleccion [data-sel-del]').length === 3, 'los seleccionados se listan con su nivel');

    // Filtro de busqueda.
    doc.querySelector('#c-buscar').value = 'papa';
    doc.querySelector('#c-buscar').dispatchEvent(new doc.defaultView.Event('input'));
    await esperar(120);
    const filtrados = doc.querySelectorAll('#catalogo-chips [data-cat-chip]').length;
    check(filtrados > 0 && filtrados < 51, `el buscador filtra el catalogo (51 -> ${filtrados})`);

    // Historial de compras.
    check(doc.querySelectorAll('#tbody-compras tr').length >= 1, 'el historial de compras carga');
  }

  // Limpieza: quitar el ingrediente de prueba. Si se queda, la IA lo tomara como real
  // y generara platos alrededor de el (la despensa es la entrada del planificador).
  const fin = await apiSrv('/api/despensa');
  const sobra = fin.despensa.find((d) => d.nombre === INGREDIENTE);
  if (sobra) await apiSrv(`/api/despensa/${sobra.id}`, { method: 'DELETE' });
  console.log(`\n(limpieza: ingrediente de prueba ${sobra ? 'eliminado' : 'no encontrado'})`);

  console.log(fallos ? `\n=== ${fallos} FALLA(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
