// Smoke test del DASHBOARD (inicio.html), la barra inferior movil y el perfil del usuario.
// Carga la pagina en un DOM real contra el servidor de :3002 y reporta errores de runtime.
//
// No usa IA: es gratis. Deja la cuenta de prueba como la encontro (sin foto, misma contrasena).
// Ver pruebas/README.md.
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://localhost:3002';
const EMAIL = 'fam@test.pe';
const PASS = 'prueba123';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (doc, sel) => (doc.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

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
      win.fetch = (url, opts) => fetch(String(url).startsWith('http') ? url : BASE + url, opts);
      // jsdom no implementa canvas. El perfil lo usa SOLO para comprimir la foto elegida, asi
      // que se sustituye por un doble: sin esto la pagina entera reventaria al cargar.
      win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
      win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
    },
  });
  await esperar(1800);
  return { dom, doc: dom.window.document, errores };
}

(async () => {
  const { token, usuario } = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })).json();
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let fallos = 0;
  const check = (cond, msg) => { console.log((cond ? '  OK   ' : '  FALLA ') + msg); if (!cond) fallos++; };

  // ================= API =================
  console.log('\n=== GET /api/inicio ===');
  const r = await fetch(`${BASE}/api/inicio`, { headers: H });
  const d = await r.json();
  check(r.status === 200, `responde 200 (fue ${r.status})`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(d.hoy || ''), `trae la fecha de hoy (${d.hoy})`);
  check(Array.isArray(d.hoy_platos) && d.hoy_platos.length === 3,
    `trae las 3 comidas del dia (= ${(d.hoy_platos || []).length})`);
  check(d.hoy_platos.map((h) => h.momento).join(',') === 'desayuno,almuerzo,cena',
    'en orden desayuno -> almuerzo -> cena');
  const st = d.stats || {};
  const claves = ['semanas_programadas', 'platos_guardados', 'despensa_productos', 'consumo_despensa',
    'integrantes', 'generaciones_total', 'analisis_total'];
  check(claves.every((k) => Number.isFinite(st[k])), `todas las estadisticas son numeros (${claves.filter((k) => !Number.isFinite(st[k])).join(', ') || 'ok'})`);
  check(st.consumo_despensa >= 0 && st.consumo_despensa <= 100, `el consumo va de 0 a 100 (= ${st.consumo_despensa}%)`);
  // El dashboard NO debe inventar datos: sus conteos tienen que coincidir con los endpoints
  // que ya existian, o dos pantallas dirian numeros distintos de lo mismo.
  const desp = (await (await fetch(`${BASE}/api/despensa`, { headers: H })).json()).despensa || [];
  check(st.despensa_productos === desp.length,
    `los productos cuadran con /api/despensa (${st.despensa_productos} vs ${desp.length})`);
  const hog = await (await fetch(`${BASE}/api/hogar`, { headers: H })).json();
  check(st.integrantes === (hog.integrantes || []).length,
    `los integrantes cuadran con /api/hogar (${st.integrantes} vs ${(hog.integrantes || []).length})`);

  // ================= PAGINA =================
  console.log('\n=== inicio.html ===');
  const p = await abrir('inicio.html', token, usuario);
  check(p.errores.length === 0, `sin errores de runtime ${p.errores.length ? '-> ' + p.errores.join(' | ') : ''}`);
  check(/Buenos días|Buenas tardes|Buenas noches/.test(txt(p.doc, '#saludo')), `saluda por la hora: "${txt(p.doc, '#saludo')}"`);
  check(txt(p.doc, '#saludo').includes((usuario.nombre || '').split(' ')[0]), 'y por su nombre');
  check(/\d{1,2} de [a-z]+/.test(txt(p.doc, '#lbl-fecha-hoy')), `muestra la fecha de hoy: "${txt(p.doc, '#lbl-fecha-hoy')}"`);
  check(p.doc.querySelectorAll('#hoy-platos .hoy-card').length === 3, 'pinta las 3 comidas del dia');
  // Una casilla vacia se MUESTRA invitando a llenarla: esconderla haria creer que el dia esta
  // completo.
  const vacias = p.doc.querySelectorAll('#hoy-platos .hoy-card.vacia').length;
  const conPlato = d.hoy_platos.filter((h) => h.plato).length;
  check(vacias === 3 - conPlato, `las comidas sin planificar se muestran igual (${vacias} vacias, ${conPlato} con plato)`);
  const tarjetas = p.doc.querySelectorAll('#stats .stat-card');
  check(tarjetas.length === 8, `8 tarjetas de estadistica (= ${tarjetas.length})`);
  check([...tarjetas].every((t) => /tono-/.test(t.className)), 'todas con su color por tema');
  check([...tarjetas].every((t) => (t.querySelector('.stat-valor')?.textContent || '').trim().length > 0),
    'y todas con un valor pintado');
  check(txt(p.doc, '#card-plan').includes(usuario.plan_nombre || 'Free'), 'la tarjeta del plan muestra el plan actual');
  check(txt(p.doc, '#card-periodo').length > 20, 'la tarjeta de la compra dice algo');

  // ================= BARRA INFERIOR =================
  console.log('\n=== barra inferior (movil) ===');
  const bn = [...p.doc.querySelectorAll('.bottomnav a')];
  check(bn.length === 5, `5 opciones (= ${bn.length})`);
  check(bn.map((a) => a.textContent.replace(/[^A-Za-zÁ-úñ]/g, '')).join(',') === 'Inicio,Analizar,Plan,Despensa,Platos',
    `en el orden pedido: ${bn.map((a) => a.textContent.trim()).join(' | ')}`);
  check(p.doc.querySelectorAll('.bottomnav a.active').length === 1, 'la seccion actual sale marcada');

  // ================= PERFIL =================
  console.log('\n=== perfil del usuario ===');
  const btn = p.doc.querySelector('.userbox-btn');
  check(!!btn, 'el nombre del usuario es pulsable');
  btn.click();
  await esperar(300);
  const modal = p.doc.querySelector('.modal-back .modal');
  check(!!modal, 'se abre el modal del perfil');
  check(['p-nombre', 'p-email', 'p-pass-act', 'p-pass-new'].every((i) => !!p.doc.querySelector('#' + i)),
    'con los campos de datos y de contrasena');
  check(!!p.doc.querySelector('#p-elegir') && !!p.doc.querySelector('#p-file'), 'y con la subida de foto');
  check(p.doc.querySelector('#p-nombre').value === usuario.nombre, 'los datos vienen cargados');

  // Cambiar la contrasena exige la ACTUAL aunque la sesion este abierta.
  p.doc.querySelector('#p-pass-act').value = 'no-es-la-mia';
  p.doc.querySelector('#p-pass-new').value = 'otraclave123';
  p.doc.querySelector('#p-cambiar-pass').click();
  await esperar(900);
  check(/no es correcta/i.test(txt(p.doc, '#perfil-alerta')),
    `con la contrasena actual mal, la rechaza: "${txt(p.doc, '#perfil-alerta')}"`);

  // ================= LIMITES DE LA FOTO =================
  // Se prueban por API: son la defensa de la BD, y el cliente no es el unico que puede llamar.
  console.log('\n=== limites de la foto (API) ===');
  const patch = async (b) => {
    const rr = await fetch(`${BASE}/api/auth/perfil`, { method: 'PATCH', headers: H, body: JSON.stringify(b) });
    return { status: rr.status, d: await rr.json() };
  };
  const ok = await patch({ foto: 'data:image/jpeg;base64,' + 'A'.repeat(3000) });
  check(ok.status === 200 && !!ok.d.usuario.foto, 'acepta una foto valida y la devuelve');
  const yo = await (await fetch(`${BASE}/api/auth/yo`, { headers: H })).json();
  check(!!yo.usuario.foto, 'y persiste (usuarioPublico la expone)');
  check((await patch({ foto: 'data:image/jpeg;base64,' + 'A'.repeat(500000) })).status === 400,
    'rechaza una foto demasiado grande (no se infla la BD)');
  check((await patch({ foto: 'javascript:alert(1)' })).status === 400, 'rechaza lo que no es una imagen');
  check((await patch({ nombre: '   ' })).status === 400, 'rechaza el nombre vacio');

  // Limpieza: la cuenta queda sin foto, como estaba.
  const fin = await patch({ foto: null });
  check(fin.status === 200 && fin.d.usuario.foto === null, '(limpieza) la foto se puede quitar');

  console.log(fallos ? `\n=== ${fallos} FALLA(S) ===` : '\n=== TODO OK ===');
  process.exit(fallos ? 1 : 0);
})();
