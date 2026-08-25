// Smoke test de compras.html ("Mis compras"): carga la pagina en un DOM real (jsdom) contra el
// servidor en :3002 y comprueba la lista con la que se camina el supermercado.
//
// Lo que fija esta prueba:
//   - TODO arranca DESMARCADO (se marca en el mercado, conforme cae al carro).
//   - Cada pasillo dice cuantos llevas y CUANTO llevas gastado en el (subtotal).
//   - El subtotal solo cuenta lo MARCADO, y no se contagia entre pasillos.
//   - La lista se arma con los platos programados de esa semana, cada vez que entras.
//
// Crea SU PROPIO usuario (con hogar, platos y plan) y lo borra al terminar: no hereda estado
// de otra corrida ni depende de la fecha en que se ejecute.
//
// No usa IA: es gratis.
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const db = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))(
  path.join(__dirname, '..', 'nutrichefia.db')
);

const BASE = 'http://localhost:3002';
const EMAIL = `smoke-compras-${Date.now()}@test.pe`;
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
  await esperar(2200);
  return { dom, win: dom.window, doc: dom.window.document, errores };
}

(async () => {
  let fallos = 0;
  const check = (cond, msg) => { console.log((cond ? '  OK   ' : '  FALLA ') + msg); if (!cond) fallos++; };

  const reg = await (await fetch(`${BASE}/api/auth/registro`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Smoke Compras', email: EMAIL, password: PASS }),
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
    console.log(`\n(limpieza: usuario de prueba borrado -> ${r.changes} fila)`);
  };

  try {
    // El hogar necesita un integrante para quedar "configurado": sin eso, /api/plan/necesidad
    // responde 403 y la lista no se puede armar. La despensa se queda APAGADA a proposito:
    // llevar la cuenta del gasto no depende de llevar inventario, y eso hay que comprobarlo.
    await apiSrv('/api/hogar', { method: 'PUT', body: JSON.stringify({ region: 'costa', ciudad: 'Lima' }) });
    await apiSrv('/api/hogar/integrantes', { method: 'POST', body: JSON.stringify({ nombre: 'Ana', edad: 30 }) });

    // Dos platos de dos pasillos distintos: hace falta mas de una categoria para comprobar que
    // el subtotal de un pasillo no se contagia al de al lado.
    const plato1 = await apiSrv('/api/platos', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Guiso de prueba', momento: 'almuerzo', porciones: 2,
        ingredientes: [{ nombre: 'Pollo', cantidad: '500', unidad: 'g' }, { nombre: 'Cebolla', cantidad: '2', unidad: 'unidad' }],
      }),
    });
    const plato2 = await apiSrv('/api/platos', {
      method: 'POST',
      body: JSON.stringify({
        nombre: 'Avena de prueba', momento: 'desayuno', porciones: 2,
        ingredientes: [{ nombre: 'Avena', cantidad: '1', unidad: 'taza' }],
      }),
    });
    check(plato1.status === 201 || plato1.status === 200, `se creo el plato 1 (status ${plato1.status})`);

    // Semana FIJA y lejana: no depende de la fecha en que se corra el test ni pisa nada.
    const SEMANA = '2027-03-01'; // un lunes
    const FIN = '2027-03-07';
    await apiSrv('/api/plan', { method: 'POST', body: JSON.stringify({ semana: SEMANA, dia: 1, momento: 'almuerzo', plato_id: plato1.cuerpo.plato.id }) });
    await apiSrv('/api/plan', { method: 'POST', body: JSON.stringify({ semana: SEMANA, dia: 2, momento: 'desayuno', plato_id: plato2.cuerpo.plato.id }) });

    const nec = await apiSrv(`/api/plan/necesidad?inicio=${SEMANA}&fin=${FIN}`);
    check(nec.status === 200, `/necesidad responde 200 sin despensa activa (fue ${nec.status})`);
    check(nec.cuerpo.items.length === 3, `la semana necesita 3 productos (= ${nec.cuerpo.items.length})`);

    console.log('\n=== compras.html ===');
    const { doc, win, errores } = await abrir(`compras.html?inicio=${SEMANA}&fin=${FIN}`, token, usuario);
    check(errores.length === 0, `sin errores de runtime ${errores.join(' | ')}`);

    const checks = [...doc.querySelectorAll('#lista-productos input[data-check]')];
    check(checks.length === 3, `la lista pinta los 3 productos del plan (= ${checks.length})`);
    // Lo que se marca es lo que YA cae al carro. Darlo por hecho obliga a desmarcar lo que no
    // encontraste, que es justo lo que uno olvida hacer.
    check(checks.every((c) => !c.checked), `TODOS arrancan desmarcados (marcados: ${checks.filter((c) => c.checked).length})`);
    check((doc.getElementById('t-marcados')?.textContent || '').startsWith('0 de '),
      `el resumen de arriba dice "${doc.getElementById('t-marcados')?.textContent}"`);

    const subs = [...doc.querySelectorAll('.cat-subtotal')];
    const cabs = [...doc.querySelectorAll('.cat-cab')];
    check(subs.length === cabs.length && subs.length >= 2, `cada pasillo trae su subtotal (${subs.length} pasillos)`);
    check(subs.every((s) => /0\.00/.test(s.textContent)), 'y arrancan todos en cero');

    // Marcar un producto y ponerle precio mueve la cuenta y el subtotal de SU pasillo.
    const primero = checks[0];
    const pasillo = primero.closest('.cat-acordeon');
    primero.checked = true;
    primero.dispatchEvent(new win.Event('change', { bubbles: true }));
    await esperar(120);
    check(/^1 de /.test(pasillo.querySelector('.cat-cuenta').textContent),
      `la cuenta del pasillo sube: "${pasillo.querySelector('.cat-cuenta').textContent}"`);

    const precio = doc.querySelector(`[data-precio="${primero.dataset.check}"]`);
    precio.value = '12.50';
    precio.dispatchEvent(new win.Event('input', { bubbles: true }));
    await esperar(120);
    check(/12\.50/.test(pasillo.querySelector('.cat-subtotal').textContent),
      `el subtotal del pasillo recoge el precio: "${pasillo.querySelector('.cat-subtotal').textContent}"`);
    check(/12\.50/.test(doc.getElementById('t-gastado').textContent),
      `y el total de arriba tambien: "${doc.getElementById('t-gastado').textContent}"`);

    const otro = [...doc.querySelectorAll('.cat-acordeon')].find((c) => c !== pasillo);
    check(!!otro && /0\.00/.test(otro.querySelector('.cat-subtotal').textContent),
      'el subtotal de otro pasillo sigue en cero (cada uno cuenta lo suyo)');

    // Desmarcar devuelve el subtotal a cero aunque el precio siga escrito: el subtotal es de lo
    // COMPRADO, no de lo que costaria.
    primero.checked = false;
    primero.dispatchEvent(new win.Event('change', { bubbles: true }));
    await esperar(120);
    check(/0\.00/.test(pasillo.querySelector('.cat-subtotal').textContent),
      'al desmarcar, el subtotal vuelve a cero');

    check(/se arma de nuevo cada vez que entras/i.test(doc.body.textContent),
      'la pagina explica que la lista se rehace con el plan de esa semana');

    win.close();
  } finally {
    limpiar();
  }

  console.log(fallos ? `\n=== ${fallos} FALLO(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
