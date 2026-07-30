// Smoke test de hogar.html y despensa.html: las carga en un DOM real (jsdom), contra
// el servidor de verdad en :3002, y reporta cualquier error de runtime.
// Ejercita: carga inicial, chips de condiciones/alergias, guardar integrante,
// agregar ingrediente, tab de compra, seleccion y filtro del catalogo.
// Ver pruebas/README.md.
//
// No usa IA: es gratis y rapido. DEJA el hogar de prueba en un estado conocido
// (Casa Abanto + Rosa/Luis/Ana) porque el test necesita conteos estables.
const { JSDOM, VirtualConsole } = require('jsdom');
// Ya no se importa src/db: la limpieza de la compra de prueba usa el endpoint
// DELETE /api/despensa/compras/:id. Mejor asi — importar db.js abria una segunda conexion de
// escritura a la misma BD (y le corria las migraciones) solo para un DELETE.

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

// Llamada directa a la API (fuera del jsdom): sirve para comprobar que lo que la pagina
// hizo se GUARDO de verdad en el servidor, y no solo que se pinto en pantalla.
async function api(ruta, token, { method = 'GET', body } = {}) {
  const r = await fetch(BASE + ruta, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.json();
}

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

  // Producto unico por corrida, para que "agregar" siempre sea un alta real
  // (el dedup de la despensa es correcto, pero haria que el conteo no cambie).
  const INGREDIENTE = 'Hierba de prueba ' + Date.now(); // se agrega en "Registrar compra"
  let porcentajesPrevios = []; // snapshot de la despensa antes de la compra de prueba (se restaura al final)
  let idsPrevios = null;       // que productos existian antes: lo que aparezca de mas, lo creo el test

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
  // Modelo: "Mi despensa" es SOLO VER + buscar (sin form de agregar). Agregar productos y
  // marcar cuales compre vive en "Registrar compra": form de alta arriba + checklist debajo.
  console.log('\n=== despensa.html ===');
  {
    const { doc, errores } = await abrir('despensa.html', token, usuario);
    check(errores.length === 0, `sin errores de runtime ${errores.length ? '-> ' + errores.join(' | ') : ''}`);
    // Mi despensa: solo ver + buscar (sin formulario de agregar ni chips).
    check(doc.querySelector('#btn-add-ing') === null && doc.querySelector('#catalogo-chips') === null, 'Mi despensa no tiene formulario de agregar ni chips');
    check(!!doc.querySelector('#buscar-despensa'), 'Mi despensa tiene un buscador');
    const antes = doc.querySelectorAll('#lista-despensa [data-del]').length;
    check(antes > 0, `${antes} productos pintados`);
    check(doc.querySelectorAll('#lista-despensa .cat-chip').length > 0, 'los productos salen agrupados por categoria');

    // Barra de stock: cada producto muestra el % que le queda y se puede editar a mano.
    // El select poco/normal/bastante ya NO esta aqui: el porcentaje es la fuente de verdad.
    check(doc.querySelectorAll('#lista-despensa .stock-barra').length === antes, `cada producto trae su barra de stock (= ${doc.querySelectorAll('#lista-despensa .stock-barra').length})`);
    check(doc.querySelectorAll('#lista-despensa [data-nivel]').length === 0, 'el select de nivel ya no esta en Mi despensa');
    const rango = doc.querySelector('#lista-despensa .stock-rango');
    check(!!rango && rango.type === 'range', 'la barra se edita con un control de rango');
    check(/Te queda|acabó/.test(txt(doc, '#lista-despensa .stock-lbl')), `la etiqueta dice cuanto queda: "${txt(doc, '#lista-despensa .stock-lbl')}"`);

    // Editar a mano PERSISTE: se mueve el rango, se suelta (change) y se recarga del servidor.
    const idEditado = rango.dataset.pct;
    const pctOriginal = Number(rango.value);
    const pctNuevo = pctOriginal >= 50 ? 25 : 75;
    rango.value = String(pctNuevo);
    rango.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    await esperar(700);
    const guardado = (await api(`/api/despensa`, token)).despensa.find((i) => String(i.id) === idEditado);
    check(guardado.porcentaje === pctNuevo, `el % editado a mano se guarda (${pctOriginal}% -> ${guardado.porcentaje}%)`);
    // El nivel es DERIVADO: nunca puede contradecir a la barra.
    const esperado = pctNuevo <= 30 ? 'poco' : pctNuevo <= 70 ? 'normal' : 'bastante';
    check(guardado.nivel === esperado, `el nivel se deriva del %: ${guardado.porcentaje}% -> "${guardado.nivel}"`);
    // Se deja como estaba: el resto del smoke (y la siguiente corrida) no debe heredarlo.
    await api(`/api/despensa/${idEditado}`, token, { method: 'PATCH', body: { porcentaje: pctOriginal } });
    // El buscador filtra la despensa.
    doc.querySelector('#buscar-despensa').value = 'zzz-no-existe';
    doc.querySelector('#buscar-despensa').dispatchEvent(new doc.defaultView.Event('input'));
    await esperar(80);
    check(doc.querySelectorAll('#lista-despensa [data-del]').length === 0, 'el buscador filtra la despensa');
    doc.querySelector('#buscar-despensa').value = '';
    doc.querySelector('#buscar-despensa').dispatchEvent(new doc.defaultView.Event('input'));
    await esperar(60);

    // Registrar compra: form de agregar (nombre+categoria+nivel) + checklist por categoria.
    doc.querySelector('#t-compra').click(); await esperar(150);
    check(!doc.querySelector('#panel-compra').classList.contains('hidden'), 'la tab de registrar compra se muestra');
    check(!!doc.querySelector('#cc-nombre') && doc.querySelector('#cc-cat').options.length === 11 && doc.querySelector('#cc-nivel').options.length === 3,
      'el form de agregar (nombre + categoria + nivel) esta en Registrar compra');
    check(doc.querySelector('#c-semanas').options.length === 8, `selector de semanas con 8 opciones (= ${doc.querySelector('#c-semanas').options.length})`);
    check(/Cubre del/.test(txt(doc, '#c-periodo')), `el rango del periodo se muestra: "${txt(doc, '#c-periodo')}"`);

    // El checklist muestra los productos de la despensa por categoria, marcados por defecto.
    // OJO: son <button>, no <input type=checkbox> — "c.checked" seria undefined y el aserto
    // pasaria SIEMPRE (asi estuvo, dando un falso OK en el desmarcado). El estado marcado se
    // lee de la clase: sin "btn-ghost" = marcado.
    const marcados = () => [...doc.querySelectorAll('#checklist-compra [data-check]')].filter((b) => !b.classList.contains('btn-ghost')).length;
    check(doc.querySelectorAll('#checklist-compra [data-check]').length === antes, `el checklist lista los ${antes} productos (= ${doc.querySelectorAll('#checklist-compra [data-check]').length})`);
    check(doc.querySelectorAll('#checklist-compra .cat-chip').length > 0, 'el checklist sale agrupado por categoria');
    check(marcados() === antes, `arrancan todos marcados (${marcados()} de ${antes})`);

    // El checklist ofrece DOS conjuntos: lo que ya tienes + los faltantes del plan de ese
    // periodo (marcados con ●), que son los que traes del mercado. Los faltantes arrancan
    // SIN marcar: dar de alta algo que no compraste ensucia la despensa y la IA planifica
    // alrededor de lo que encuentre ahi.
    // Se apunta el periodo a una semana que SI tenga platos: con la semana actual vacia el
    // aserto pasaria con 0 faltantes sin comprobar nada (un falso OK como los que ya me
    // mordieron). El periodo se deja como estaba al terminar.
    {
      const { semanas } = await api('/api/plan/semanas', token);
      const conPlan = semanas.sort((a, b) => b.items - a.items)[0];
      if (!conPlan) {
        check(false, 'el usuario de prueba no tiene ninguna semana con platos (no se pudo probar el ●)');
      } else {
        const fin = new Date(new Date(conPlan.semana + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
        const win = doc.defaultView;
        [...doc.querySelectorAll('input[name=modo-periodo]')].find((r) => r.value === 'fechas').checked = true;
        doc.querySelectorAll('input[name=modo-periodo]').forEach((r) => r.dispatchEvent(new win.Event('change', { bubbles: true })));
        doc.querySelector('#c-fecha-ini').value = conPlan.semana;
        doc.querySelector('#c-fecha-fin').value = fin;
        doc.querySelector('#c-fecha-fin').dispatchEvent(new win.Event('change', { bubbles: true }));
        await esperar(1200);

        const falt = (await api(`/api/plan/faltantes?inicio=${conPlan.semana}&fin=${fin}`, token)).items || [];
        const enDespensa = new Set((await api('/api/despensa', token)).despensa.map((d) => d.nombre.toLowerCase()));
        const esperados = falt.filter((f) => !enDespensa.has(f.nombre.toLowerCase())).length;
        const conPunto = [...doc.querySelectorAll('#checklist-compra [data-check]')].filter((b) => b.textContent.includes('●'));
        check(esperados > 0, `la semana ${conPlan.semana} tiene ${esperados} faltantes con los que probar`);
        check(conPunto.length === esperados, `los faltantes del plan tambien se ofrecen (● ${conPunto.length}, esperados ${esperados})`);
        check(conPunto.every((b) => b.classList.contains('btn-ghost')), 'y arrancan SIN marcar (no se dan de alta solos)');
        check(marcados() === antes, `los de la despensa siguen marcados y los ● no (${marcados()} marcados de ${antes + esperados})`);

        // CUANTO pide el plan de cada producto, debajo de su nombre. Sale de
        // GET /api/plan/necesidad, que a diferencia de /faltantes incluye tambien lo que el
        // usuario YA tiene: aqui ve su despensa entera y es de eso de lo que decide si repone.
        const pide = [...doc.querySelectorAll('#checklist-compra .pide-plan')];
        check(pide.length > 0, `la pantalla de compra dice cuanto pide el plan (${pide.length} productos)`);
        check(pide.every((el) => /Tu plan pide\s+\S+/.test(el.textContent)),
          `con cantidad y unidad: "${(pide[0] || {}).textContent || ''}"`);
        // La clave: NO son solo los faltantes. Si /necesidad se cambiara por /faltantes, esto
        // caeria a los ~18 faltantes y el usuario perderia el dato de lo que ya tiene.
        const nec = (await api(`/api/plan/necesidad?inicio=${conPlan.semana}&fin=${fin}`, token)).items || [];
        check(nec.length > esperados,
          `incluye lo que YA tienes, no solo los faltantes (${nec.length} en el plan vs ${esperados} faltantes)`);
        check(nec.filter((i) => i.falta).length === esperados,
          'y los marcados como falta coinciden con /faltantes (misma fuente, sin discrepancias)');

        // Volver al modo semanas, que es como lo encontro (el resto del test cuenta con el).
        [...doc.querySelectorAll('input[name=modo-periodo]')].find((r) => r.value !== 'fechas').checked = true;
        doc.querySelectorAll('input[name=modo-periodo]').forEach((r) => r.dispatchEvent(new win.Event('change', { bubbles: true })));
        await esperar(800);
      }
    }

    // Agregar un producto con el form -> alta a la despensa + queda en el checklist marcado.
    // Se cuenta contra el checklist, no contra la despensa: el checklist ya no es solo la
    // despensa (incluye los faltantes del plan), asi que "antes + 1" dejo de ser el total.
    const enChecklist = () => doc.querySelectorAll('#checklist-compra [data-check]').length;
    const checklistAntes = enChecklist();
    doc.querySelector('#cc-nombre').value = INGREDIENTE;
    doc.querySelector('#cc-cat').value = 'verdura';
    doc.querySelector('#btn-cc-add').click();
    await esperar(900);
    check(enChecklist() === checklistAntes + 1, `agregar suma al checklist: ${checklistAntes} -> ${enChecklist()}`);

    // "Ninguno" desmarca todo y registrar debe exigir al menos uno.
    doc.querySelector('#btn-marca-ninguno').click(); await esperar(60);
    check(marcados() === 0, `con "Ninguno" se desmarca todo (quedan ${marcados()})`);
    doc.querySelector('#btn-guardar-compra').click(); await esperar(200);
    check(/Marca al menos un producto/.test(txt(doc, '#alerta-compra')), 'registrar sin marcados avisa que marques uno');

    // Cada producto marcado trae su barra de "cuanto compre" (arranca en 100 = lleno) y los
    // NO marcados no la tienen: preguntar cuanto compraste de algo que no compraste no
    // significa nada. La barra es lo que hace exacta la compra ("esta vez traje medio kilo").
    {
      doc.querySelector('#btn-marca-todos').click(); await esperar(60);
      const rangos = doc.querySelectorAll('#checklist-compra [data-pct-compra]');
      check(rangos.length === enChecklist(), `cada producto marcado tiene su barra (${rangos.length} de ${enChecklist()})`);
      check([...rangos].every((r) => Number(r.value) === 100), 'las barras arrancan en 100% (lo compraste lleno)');
      doc.querySelector('#btn-marca-ninguno').click(); await esperar(60);
      check(doc.querySelectorAll('#checklist-compra [data-pct-compra]').length === 0, 'sin marcar no hay barra que llenar');
    }

    // "Todos" y registrar -> los marcados van al historial.
    // OJO: registrar una compra deja los productos marcados en el porcentaje de su barra (por
    // defecto 100%: acabas de comprarlos). Marcando TODOS, esta prueba aplana la despensa del
    // hogar sembrado, que tiene niveles realistas a proposito. Se guarda el estado para
    // devolverlo en la limpieza: si no, cada corrida dejaria al hogar de prueba con todo
    // lleno y el planificador veria otra casa.
    porcentajesPrevios = (await apiSrv('/api/despensa')).despensa.map((d) => ({ id: d.id, porcentaje: d.porcentaje }));
    // "Todos" marca TAMBIEN los faltantes del plan, y esos se DAN DE ALTA en la despensa al
    // registrar. Sin anotar cuales existian antes, cada corrida le metia ~18 productos
    // nuevos al hogar sembrado y la IA acabaria planificando alrededor de esa basura.
    idsPrevios = new Set(porcentajesPrevios.map((d) => d.id));
    doc.querySelector('#btn-marca-todos').click(); await esperar(60);
    // Bajar la barra de UN producto de prueba a 40%: es el caso que justifica la barra
    // ("compre, pero menos de lo normal"). Se comprueba al final que llego asi a la BD y no
    // al 100% de siempre — sin este aserto, la barra podria estar pintada y no guardarse.
    const rangoPrueba = doc.querySelector(`#checklist-compra [data-pct-compra="${INGREDIENTE.toLowerCase()}"]`);
    check(!!rangoPrueba, `el producto de prueba tiene barra de cuanto compre`);
    if (rangoPrueba) {
      rangoPrueba.value = '40';
      rangoPrueba.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      await esperar(60);
      check(/Compré/.test(txt(doc, '#checklist-compra')), 'la barra muestra cuanto compraste');
    }
    const comprasAntes = doc.querySelectorAll('#lista-compras > div').length;
    doc.querySelector('#btn-guardar-compra').click();
    await esperar(1000);
    check(/Se guardó la despensa del periodo/.test(txt(doc, '#alerta-compra')), `mensaje de exito: "${txt(doc, '#alerta-compra')}"`);
    {
      const tras = (await apiSrv('/api/despensa')).despensa.find((d) => d.nombre === INGREDIENTE);
      check(tras && tras.porcentaje === 40, `lo comprado queda en el % de su barra, no al 100 (= ${tras && tras.porcentaje})`);
      check(tras && tras.nivel === 'normal', `y el nivel se DERIVA de ese % (40 -> normal, = ${tras && tras.nivel})`);
    }
    const comprasDespues = doc.querySelectorAll('#lista-compras > div').length;
    check(comprasDespues === comprasAntes + 1, `la compra aparece en el historial: ${comprasAntes} -> ${comprasDespues}`);
    check(/Periodo \d{2}\/\d{2}/.test(txt(doc, '#lista-compras')), 'el historial muestra el periodo (dd/mm)');
    check(/periodo activo/.test(txt(doc, '#lista-compras')), 'la mas reciente se marca como "periodo activo"');

    // Volver a la despensa: el banner separa las DOS cosas que antes se mezclaban.
    // El periodo es de la COMPRA, no de la despensa (hay UNA sola, es el estado de la casa hoy).
    // El texto viejo, "Despensa del periodo X–Y", se leia como que cada semana tiene su propia
    // despensa y fue el origen de una confusion reportada: por eso se comprueba que NO vuelva.
    doc.querySelector('#t-inventario').click(); await esperar(80);
    const banner = txt(doc, '#banner-periodo');
    check(/una sola despensa/i.test(banner), `el banner dice que hay UNA despensa: "${banner.slice(0, 70)}…"`);
    check(/Tu última compra cubre/i.test(banner), 'y que el periodo es de la compra');
    check(!/Despensa del periodo/i.test(banner), 'y NO vuelve al texto que causaba la confusion');

    // ===== Selector "Esta semana / Todo el periodo" =====
    // Mirar semana a semana NO acumula: ninguna semana descuenta las anteriores. Con una compra
    // de varias semanas, sin esta opcion no habia forma de preguntar "¿me alcanza hasta la
    // proxima compra?" — y por eso nadie se enteraba de que al final del periodo se quedaba sin
    // aceite. La compra de esta prueba cubre 3 semanas, asi que el selector debe ofrecerse.
    {
      const sel = doc.querySelector('#sel-ventana');
      check(!!sel && !sel.classList.contains('hidden'), 'con una compra de varias semanas se ofrece elegir la ventana');
      const opciones = [...sel.querySelectorAll('[data-ventana]')];
      check(opciones.length === 2, `dos opciones: semana y periodo (= ${opciones.length})`);

      sel.querySelector('[data-ventana="periodo"]').click(); await esperar(900);
      const lbls = [...doc.querySelectorAll('#lista-despensa .stock-lbl')].map((e) => e.textContent.replace(/\s+/g, ' '));
      // El periodo de la compra de esta prueba puede no tener platos (el hogar sembrado los
      // tiene en otras semanas), y entonces no hay consumo que etiquetar. Se dice cual de los
      // dos casos ocurrio en vez de dar un OK que no prueba nada: un aserto con rama de escape
      // silenciosa es peor que no tenerlo.
      const conConsumo = lbls.filter((t) => /−\d+%/.test(t)).length;
      check(conConsumo === 0 || lbls.some((t) => /todo el periodo −\d+%/.test(t)),
        conConsumo
          ? `al elegir el periodo las barras dicen "todo el periodo": "${lbls.find((t) => /todo el periodo/.test(t))}"`
          : 'el periodo de la compra no tiene platos programados: no hay consumo que etiquetar (se comprueba en el banner y en la acumulacion)');
      check(/todo el periodo/i.test(txt(doc, '#banner-periodo')), 'y el banner anuncia que son varias semanas');

      // Lo que de verdad hay que fijar: un rango de varias semanas SUMA los platos de todas.
      // Se compara la semana con mas platos contra un rango que la contiene junto a otras.
      const tot = (a) => a.reduce((n, d) => n + (d.consumo_previsto || 0), 0);
      const todasSem = ((await api('/api/plan/semanas', token)).semanas || []).sort((a, b) => a.semana.localeCompare(b.semana));
      const primera = todasSem[0];
      const ultima = todasSem[todasSem.length - 1];
      if (primera && ultima && primera.semana !== ultima.semana) {
        const finPrimera = new Date(new Date(primera.semana + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
        const finUltima = new Date(new Date(ultima.semana + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
        const unaSem = tot((await api(`/api/despensa?inicio=${primera.semana}&fin=${finPrimera}`, token)).despensa);
        const todo = tot((await api(`/api/despensa?inicio=${primera.semana}&fin=${finUltima}`, token)).despensa);
        check(todo > unaSem, `un rango de varias semanas ACUMULA (${unaSem} pts en la semana ${primera.semana} vs ${todo} pts en el rango completo)`);
      } else {
        check(false, 'el usuario de prueba no tiene dos semanas con platos (no se pudo probar la acumulacion)');
      }

      // Volver a "esta semana", que es como lo encontro el resto del test.
      sel.querySelector('[data-ventana="semana"]').click(); await esperar(700);
      check(!/todo el periodo/i.test(txt(doc, '#lista-despensa .stock-lbl')),
        'y se puede volver a la semana (las barras dejan de hablar del periodo)');
    }

    // ===== Quitar un registro del historial =====
    // Lo que HAY QUE comprobar no es que la fila desaparezca, es que la DESPENSA NO CAMBIE:
    // "compras" es historial y la despensa es lo que hay en casa. Si borrar un registro
    // vaciara el inventario, el usuario perderia su despensa por limpiar una lista (y la IA
    // planificaria alrededor de una casa vacia). Lo garantizan los FK del esquema
    // (compra_items CASCADE, despensa.compra_id SET NULL), asi que esto es su prueba.
    {
      doc.querySelector('#t-compra').click(); await esperar(150);
      const antesDeBorrar = (await apiSrv('/api/despensa')).despensa
        .map((d) => `${d.nombre}:${d.porcentaje}`).sort().join('|');
      const nFilas = doc.querySelectorAll('#lista-compras > div').length;
      const botones = doc.querySelectorAll('#lista-compras [data-del-compra]');
      check(botones.length === nFilas, `cada compra del historial tiene su boton de quitar (${botones.length} de ${nFilas})`);

      botones[0].click(); await esperar(200);
      const modal = doc.querySelector('.modal-back .modal');
      check(!!modal, 'quitar pide confirmacion con el modal propio (no el confirm nativo)');
      const txtModal = modal ? modal.textContent.replace(/\s+/g, ' ') : '';
      check(/despensa no cambia/i.test(txtModal), `el modal aclara que la despensa no cambia: "${txtModal.slice(0, 90)}…"`);
      check(/periodo activo|única/i.test(txtModal), 'y avisa que era el periodo activo');

      // Cancelar NO borra nada.
      doc.querySelector('.modal-back [data-no]').click(); await esperar(300);
      check(doc.querySelectorAll('#lista-compras > div').length === nFilas, 'al cancelar no se borra nada');

      // Confirmar si.
      doc.querySelectorAll('#lista-compras [data-del-compra]')[0].click(); await esperar(200);
      doc.querySelector('.modal-back [data-si]').click(); await esperar(900);
      check(doc.querySelectorAll('#lista-compras > div').length === nFilas - 1,
        `confirmar quita la fila del historial: ${nFilas} -> ${doc.querySelectorAll('#lista-compras > div').length}`);
      check(/no cambió|no cambio/i.test(txt(doc, '#alerta-compra')), `avisa que la despensa no cambio: "${txt(doc, '#alerta-compra')}"`);

      const despuesDeBorrar = (await apiSrv('/api/despensa')).despensa
        .map((d) => `${d.nombre}:${d.porcentaje}`).sort().join('|');
      check(despuesDeBorrar === antesDeBorrar, 'LA DESPENSA QUEDA IDENTICA (mismos productos y mismos %)');

      // Y el registro se fue de verdad del servidor, no solo de la pantalla.
      const hist = (await apiSrv('/api/despensa/compras')).compras;
      check(hist.length === nFilas - 1, `y del servidor: el historial tiene ${hist.length} (antes ${nFilas})`);

      // apiSrv devuelve el cuerpo, no la respuesta: el status se pide con fetch directo.
      const fantasma = await fetch(`${BASE}/api/despensa/compras/999999`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      check(fantasma.status === 404, `borrar una compra inexistente (o de otro) da 404 (fue ${fantasma.status})`);
    }
  }

  // ================= LA DESPENSA CON LA VENTANA DE OTRA SEMANA =================
  // La despensa se abre desde el plan con ?inicio=&fin= de la semana que se estaba viendo.
  // Antes NO recibia ventana y el backend caia a la semana ACTUAL: mirabas el plan del 13/07,
  // entrabas a la despensa y las barras proyectaban el consumo del 27/07. El numero no
  // correspondia a la semana que tenias delante, y de ahi la sensacion de que la despensa y el
  // plan iban por separado.
  console.log('\n=== despensa.html?inicio=&fin= (proyeccion de OTRA semana) ===');
  {
    const { semanas } = await api('/api/plan/semanas', token);
    const conPlan = (semanas || []).sort((a, b) => b.items - a.items)[0];
    if (!conPlan) {
      check(false, 'el usuario de prueba no tiene semanas con platos (no se pudo probar la ventana)');
    } else {
      const fin = new Date(new Date(conPlan.semana + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const conV = await abrir(`despensa.html?inicio=${conPlan.semana}&fin=${fin}`, token, usuario);
      check(conV.errores.length === 0, `sin errores de runtime ${conV.errores.join(' | ')}`);

      const b = txt(conV.doc, '#banner-periodo');
      check(/Las barras muestran lo que se lleva la semana/i.test(b), `el banner anuncia de que semana son los numeros: "${b.slice(-80)}"`);
      const lbls = [...conV.doc.querySelectorAll('#lista-despensa .stock-lbl')].map((e) => e.textContent.replace(/\s+/g, ' '));
      check(lbls.some((t) => /esa semana −\d+%/.test(t)), `las barras dicen "esa semana", no "esta": "${lbls.find((t) => /esa semana/.test(t)) || lbls[0]}"`);
      // Y la compra arranca en ESA semana: vienes de ver que te falta ahi.
      check(conV.doc.querySelector('#c-inicio').value === conPlan.semana,
        `la compra arranca en esa semana (${conV.doc.querySelector('#c-inicio').value})`);

      // La prueba de que la ventana SIRVE de algo: sin ella los numeros son otros.
      const sinV = await abrir('despensa.html', token, usuario);
      const lblsHoy = [...sinV.doc.querySelectorAll('#lista-despensa .stock-lbl')].map((e) => e.textContent.replace(/\s+/g, ' '));
      check(lbls.join('|') !== lblsHoy.join('|'),
        'la proyeccion de esa semana DIFIERE de la de la semana actual (la ventana se respeta)');
    }
  }

  // Limpieza: quitar los productos de prueba Y el snapshot de compra que los incluyo. Si un
  // producto se queda, la IA lo tomara como real y generara platos alrededor de el (la
  // despensa es la entrada del planificador).
  //
  // La compra de prueba normalmente YA la borro la seccion de "quitar un registro" (es la mas
  // reciente, que es justo la que ese bloque elimina). Esto es el respaldo por si esa seccion
  // no llego a correr: sin el, una corrida a medias dejaria la compra colgada.
  const fin = await apiSrv('/api/despensa');
  const sobra = fin.despensa.find((d) => d.nombre === INGREDIENTE);
  let compraId = null;
  if (sobra) {
    compraId = sobra.compra_id; // null si el bloque de arriba ya borro la compra (SET NULL)
    await apiSrv(`/api/despensa/${sobra.id}`, { method: 'DELETE' });
    if (compraId) await apiSrv(`/api/despensa/compras/${compraId}`, { method: 'DELETE' });
  }
  // Borrar los productos que dio de alta la compra de prueba al marcar "Todos" (los
  // faltantes del plan). Si se quedan, el hogar sembrado deja de ser el hogar sembrado.
  let creados = 0;
  if (idsPrevios) {
    for (const d of fin.despensa) {
      if (!idsPrevios.has(d.id)) { await apiSrv(`/api/despensa/${d.id}`, { method: 'DELETE' }); creados++; }
    }
  }
  // Devolver los porcentajes que la compra de prueba puso a 100 (ver el comentario arriba).
  for (const p of porcentajesPrevios) {
    await apiSrv(`/api/despensa/${p.id}`, { method: 'PATCH', body: JSON.stringify({ porcentaje: p.porcentaje }) });
  }
  console.log(`\n(limpieza: producto de prueba ${sobra ? 'eliminado' : 'no encontrado'}${compraId ? ', compra de prueba borrada' : ''}`
    + `${creados ? `, ${creados} productos dados de alta por la prueba eliminados` : ''}`
    + `${porcentajesPrevios.length ? `, ${porcentajesPrevios.length} niveles restaurados` : ''})`);

  console.log(fallos ? `\n=== ${fallos} FALLA(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
