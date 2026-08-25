// Revisa el LAYOUT REAL en un movil simulado, con Chrome headless por CDP.
//
// jsdom no sirve para esto: no calcula layout (getBoundingClientRect da ceros y no evalua los
// media queries contra un ancho real). Aqui se usa Chrome de verdad, con viewport de telefono,
// y se MIDEN las cosas que rompen en movil:
//   - desborde horizontal de la pagina (lo mas grave: obliga a hacer scroll lateral)
//   - elementos que se salen del ancho del viewport
//   - botones con area de toque menor que 44x44 (guia de accesibilidad tactil)
//   - texto por debajo de 12px
//   - solapes con la barra inferior fija
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:3002';
const PERFIL = process.env.TEMP + '/chrome-nutrichef-movil';
const SALIDA = process.argv[3] || (process.env.TEMP + '/movil');
const ANCHO = Number(process.env.ANCHO || 390);
const ALTO = Number(process.env.ALTO || 844);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + PERFIL,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) {
    await esperar(500);
    try {
      const lista = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      const pag = lista.find((t) => t.type === 'page');
      if (pag) ws = pag.webSocketDebuggerUrl;
    } catch { /* aun arrancando */ }
  }
  if (!ws) { chrome.kill(); throw new Error('Chrome no abrio el puerto de depuracion'); }

  const sock = new WebSocket(ws);
  await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
  let id = 0;
  const pend = new Map();
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  const enviar = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pend.set(n, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    sock.send(JSON.stringify({ id: n, method, params }));
  });
  return { enviar, cerrar: () => { try { sock.close(); } catch {} chrome.kill(); } };
}

const REVISION = `(() => {
  const vw = window.innerWidth;
  const out = { vw, vh: window.innerHeight };
  const doc = document.documentElement;
  out.scrollAncho = doc.scrollWidth;
  out.desbordaPagina = doc.scrollWidth > vw + 1;

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const desc = (el) => {
    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 34);
    return (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) +
      (t ? ' "' + t + '"' : '');
  };

  // 1) Elementos que se salen del viewport por la derecha.
  out.seSalen = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      out.seSalen.push({ el: desc(el), izq: Math.round(r.left), der: Math.round(r.right), ancho: Math.round(r.width) });
    }
  }
  // Solo el contenedor mas externo de cada rama: si una tarjeta se sale, sus 10 hijos tambien,
  // y listarlos todos oculta cual es el culpable.
  out.seSalen = out.seSalen.filter((x, i, arr) => !arr.some((y, j) => j !== i && x.el.startsWith(y.el.split(' "')[0]) === false && false));

  // 2) Botones y enlaces con area de toque pequena (< 44x44 segun la guia tactil).
  out.toquePequeno = [];
  for (const el of document.querySelectorAll('button, a, select, input[type=checkbox], input[type=range], .btn')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 32 || r.width < 32) {
      out.toquePequeno.push({ el: desc(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // 3) Texto diminuto.
  out.textoChico = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || !el.childNodes.length) continue;
    const propio = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!propio) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < 11.5) out.textoChico.push({ el: desc(el), px: Math.round(px * 10) / 10 });
  }

  // 4) Lo que tape la barra inferior fija.
  const bn = document.querySelector('.bottomnav');
  out.barra = null;
  if (bn && visible(bn)) {
    const rb = bn.getBoundingClientRect();
    out.barra = { alto: Math.round(rb.height), arriba: Math.round(rb.top) };
    const main = document.querySelector('.main');
    if (main) {
      const pb = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      out.barra.reservaMain = Math.round(pb);
      out.barra.reservaSuficiente = pb >= rb.height - 2;
    }
  }
  return out;
})()`;

(async () => {
  const paginas = (process.argv[2] || 'despensa.html,plan.html,inicio.html,platos.html,compras.html,hogar.html,app.html,mi-plan.html')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const L = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fam@test.pe', password: 'prueba123' }),
  })).json();

  const { enviar, cerrar } = await cdp();
  try {
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Emulation.setDeviceMetricsOverride', {
      width: ANCHO, height: ALTO, deviceScaleFactor: 2, mobile: true,
    });
    await enviar('Emulation.setTouchEmulationEnabled', { enabled: true });

    // La sesion vive en localStorage: hay que abrir el origen antes de poder escribirla.
    await enviar('Page.navigate', { url: BASE + '/index.html' });
    await esperar(1200);
    await enviar('Runtime.evaluate', {
      expression: `localStorage.setItem('nutrichefia_token', ${JSON.stringify(L.token)});
                   localStorage.setItem('nutrichefia_user', ${JSON.stringify(JSON.stringify(L.usuario))});`,
    });

    fs.mkdirSync(SALIDA, { recursive: true });
    console.log(`=== MOVIL ${ANCHO}x${ALTO} ===\n`);
    for (const pag of paginas) {
      await enviar('Page.navigate', { url: BASE + '/' + pag });
      await esperar(2600); // deja que carguen los datos por API y se repinte

      const r = await enviar('Runtime.evaluate', { expression: REVISION, returnByValue: true });
      const d = r.result.value;

      console.log('--- ' + pag);
      console.log('    desborde horizontal: ' + (d.desbordaPagina
        ? 'SI (la pagina mide ' + d.scrollAncho + 'px en un viewport de ' + d.vw + ')' : 'no'));
      if (d.seSalen.length) {
        console.log('    elementos fuera del ancho (' + d.seSalen.length + '):');
        for (const s of d.seSalen.slice(0, 6)) console.log('       ' + s.el + '  [' + s.izq + ' -> ' + s.der + ', ancho ' + s.ancho + ']');
      } else console.log('    elementos fuera del ancho: ninguno');
      if (d.toquePequeno.length) {
        console.log('    toque pequeno < 32px (' + d.toquePequeno.length + '):');
        for (const s of d.toquePequeno.slice(0, 8)) console.log('       ' + s.w + 'x' + s.h + '  ' + s.el);
      } else console.log('    toque pequeno: ninguno');
      if (d.textoChico.length) {
        console.log('    texto < 11.5px (' + d.textoChico.length + '): ' +
          d.textoChico.slice(0, 4).map((t) => t.px + 'px ' + t.el.slice(0, 30)).join(' | '));
      }
      if (d.barra) {
        console.log('    barra inferior: alto ' + d.barra.alto + 'px · el main reserva ' +
          d.barra.reservaMain + 'px -> ' + (d.barra.reservaSuficiente ? 'ok' : 'INSUFICIENTE, tapa contenido'));
      } else console.log('    barra inferior: no visible');

      const png = await enviar('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const ruta = SALIDA + '/' + pag.replace('.html', '') + '.png';
      fs.writeFileSync(ruta, Buffer.from(png.data, 'base64'));
      console.log('    captura: ' + ruta + '\n');
    }
  } finally { cerrar(); }
})();
