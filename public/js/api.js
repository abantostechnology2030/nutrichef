// Helpers compartidos del frontend (cliente API + sesion)
const TOKEN_KEY = 'nutrichefia_token';
const USER_KEY = 'nutrichefia_user';

const Sesion = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get usuario() { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  guardar(token, usuario) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(usuario));
  },
  actualizarUsuario(usuario) { localStorage.setItem(USER_KEY, JSON.stringify(usuario)); },
  cerrar() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
};

// Cliente fetch que adjunta el token y maneja errores comunes.
async function api(ruta, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (Sesion.token) headers.Authorization = `Bearer ${Sesion.token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const resp = await fetch(ruta, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await resp.json(); } catch { /* sin cuerpo */ }

  if (resp.status === 401) {
    Sesion.cerrar();
    if (!location.pathname.endsWith('index.html') && location.pathname !== '/') {
      location.href = '/index.html';
    }
    throw { status: 401, ...(data || {}) };
  }

  if (!resp.ok) {
    throw { status: resp.status, ...(data || { error: 'Error de red' }) };
  }
  return data;
}

// Protege paginas: redirige al login si no hay sesion. Opcionalmente exige admin.
function exigirSesion({ admin = false } = {}) {
  const u = Sesion.usuario;
  if (!Sesion.token || !u) { location.href = '/index.html'; return null; }
  if (admin && u.rol !== 'admin') { location.href = '/app.html'; return null; }
  return u;
}

function iniciales(nombre) {
  return (nombre || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

// Escapa texto que se inyecta con innerHTML. Casi todo lo que pintamos viene de la IA o
// lo escribio el usuario (nombres de platos, notas, ingredientes): sin esto, unas comillas
// en un nombre rompen el atributo HTML donde va metido.
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Pinta el sidebar comun. seccionActiva = id del item a marcar.
// Ojo: "Mi suscripcion" (pagos) va aparte de "Plan de comidas" (el calendario);
// llamar a los dos "plan" confundia a los usuarios.
function pintarSidebar(seccionActiva) {
  const u = Sesion.usuario;
  const esAdmin = u?.rol === 'admin';
  const items = [
    { id: 'inicio', href: '/app.html', ic: '🔍', txt: 'Analizar producto' },
  ];
  if (u?.incluye_planificador) {
    items.push({ id: 'plan', href: '/plan.html', ic: '📅', txt: 'Plan de comidas' });
    items.push({ id: 'despensa', href: '/despensa.html', ic: '🛒', txt: 'Mi despensa' });
    items.push({ id: 'platos', href: '/platos.html', ic: '🍲', txt: 'Mis platos' });
    items.push({ id: 'hogar', href: '/hogar.html', ic: '👨‍👩‍👧', txt: 'Mi hogar' });
  }
  items.push({ id: 'suscripcion', href: '/mi-plan.html', ic: '💳', txt: 'Mi suscripcion' });
  if (!esAdmin) items.push({ id: 'soporte', href: '/soporte.html', ic: '💬', txt: 'Soporte' });
  if (esAdmin) items.push({ id: 'admin', href: '/admin.html', ic: '🛠️', txt: 'Panel admin' });

  const nav = items.map((i) =>
    `<a href="${i.href}" class="${i.id === seccionActiva ? 'active' : ''}"><span class="ic">${i.ic}</span>${i.txt}</a>`
  ).join('');

  return `
    <div class="brand"><img src="/img/logo.png?v=2" alt="NutriChefIA" class="brand-logo" /></div>
    <nav class="nav">${nav}</nav>
    <div class="sidebar-foot">
      <div class="userbox">
        <div class="avatar">${iniciales(u?.nombre)}</div>
        <div class="meta"><b>${u?.nombre || ''}</b><span>${u?.rol === 'admin' ? 'Administrador' : ('Plan ' + (u?.plan_nombre || 'Free'))}</span></div>
      </div>
      <button class="btn btn-block btn-sm" style="background:var(--logo-green);color:#fff" onclick="Sesion.cerrar(); location.href='/index.html'">Cerrar sesion</button>
    </div>`;
}

// Conecta el boton hamburguesa con el sidebar (movil).
function activarMenuMovil() {
  const sb = document.querySelector('.sidebar');
  const ov = document.querySelector('.overlay');
  document.querySelector('.hamb')?.addEventListener('click', () => { sb.classList.add('open'); ov.classList.add('show'); });
  ov?.addEventListener('click', () => { sb.classList.remove('open'); ov.classList.remove('show'); });
}

// tipo: 'error' (default) | 'ok' | 'info'. "info" es para avisar que algo esta EN CURSO:
// las llamadas a la IA tardan 20-30s y sin un aviso el usuario cree que no responde.
function alerta(el, mensaje, tipo = 'error') {
  if (!el) return;
  el.textContent = mensaje;
  const clase = { ok: 'alert-ok', info: 'alert-info' }[tipo] || 'alert-error';
  el.className = `alert show ${clase}`;
}
function limpiarAlerta(el) { if (el) el.className = 'alert'; }

// Modal de confirmacion reutilizable. Devuelve una Promesa<boolean>.
function confirmar(mensaje, { titulo = 'Confirmar', ok = 'Aceptar', peligro = false } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back show';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${titulo}</h3>
      <div class="modal-body">${mensaje}</div>
      <div class="row">
        <button class="btn btn-ghost btn-sm" data-no>Cancelar</button>
        <button class="btn ${peligro ? 'btn-danger' : ''} btn-sm" data-si>${ok}</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    const cerrar = (v) => { back.remove(); resolve(v); };
    back.querySelector('[data-no]').onclick = () => cerrar(false);
    back.querySelector('[data-si]').onclick = () => cerrar(true);
    back.onclick = (e) => { if (e.target === back) cerrar(false); };
  });
}

// Categorias de ingrediente (deben coincidir con CATEGORIAS_ING en src/db.js).
const CAT_INFO = {
  abarrote:   { ic: '🌾', txt: 'Abarrote' },
  verdura:    { ic: '🥕', txt: 'Verdura' },
  fruta:      { ic: '🍎', txt: 'Fruta' },
  carne:      { ic: '🍗', txt: 'Carne' },
  pescado:    { ic: '🐟', txt: 'Pescado' },
  lacteo:     { ic: '🥛', txt: 'Lacteo' },
  huevo:      { ic: '🥚', txt: 'Huevo' },
  legumbre:   { ic: '🫘', txt: 'Legumbre' },
  condimento: { ic: '🧂', txt: 'Condimento' },
  bebida:     { ic: '🥤', txt: 'Bebida' },
  otro:       { ic: '🍽️', txt: 'Otro' },
};
function chipCategoria(cat) {
  const i = CAT_INFO[cat] || CAT_INFO.otro;
  return `<span class="cat-chip cat-${cat}">${i.ic} ${i.txt}</span>`;
}

// Momentos del dia del plan de comidas (deben coincidir con MOMENTOS en src/db.js).
const MOMENTO_INFO = {
  desayuno: { ic: '🌅', txt: 'Desayuno' },
  almuerzo: { ic: '☀️', txt: 'Almuerzo' },
  cena:     { ic: '🌙', txt: 'Cena' },
};

// Registra el Service Worker en TODAS las paginas (incluido el login) para que la
// PWA sea instalable en movil. Registraciones repetidas del mismo SW son inocuas.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Pie de pagina global (se inyecta en todas las paginas que cargan este script).
(function pintarFooter() {
  if (document.querySelector('.site-footer')) return;
  const f = document.createElement('footer');
  f.className = 'site-footer';
  f.innerHTML = '<span class="marca">NutriChefIA</span> es un producto de ' +
    '<a href="https://www.solucionesctec.com" target="_blank" rel="noopener">www.solucionesctec.com</a>' +
    ' · Todos los derechos reservados 2026';
  const main = document.querySelector('.main');
  if (main) {
    main.appendChild(f);
  } else {
    document.body.classList.add('auth-page'); // login/registro
    document.body.appendChild(f);
  }
})();

// ===== ICONOS POR INGREDIENTE (fuente unica: la usan despensa, platos y el plan) =====
//
// El icono se DERIVA del nombre; el usuario no elige nada. Es coherente con la categoria
// automatica de la despensa: nadie deberia tener que clasificar su cebolla.
//
// El emparejamiento es por PALABRA COMPLETA, no por substring, y no es un capricho: "sal"
// esta contenida en "salsa de soya" y "papa" en "papaya". Con substring, la salsa saldria con
// el icono de la sal y la papaya con el de la papa. Es la misma regla que usa
// services/consumo.js para descontar de la despensa, y por el mismo motivo.
//
// Se recorren las palabras EN ORDEN y gana la primera que tenga icono, asi "caldo de pollo"
// sale como caldo y no como pollo. La lista salio de inventariar los ingredientes REALES
// (51 del catalogo + 162 distintos en los platos de produccion), no de imaginarlos.
const ICONO_ING = {
  arroz: '\u{1F35A}', quinua: '\u{1F33E}', canihua: '\u{1F33E}', semola: '\u{1F33E}',
  avena: '\u{1F963}', harina: '\u{1F33E}', trigo: '\u{1F33E}',
  fideos: '\u{1F35D}', fideo: '\u{1F35D}', tallarin: '\u{1F35D}', tallarines: '\u{1F35D}',
  pasta: '\u{1F35D}', spaghetti: '\u{1F35D}',
  aceite: '\u{1FAD9}', mantequilla: '\u{1F9C8}', margarina: '\u{1F9C8}',
  vinagre: '\u{1F376}', salsa: '\u{1F376}', sillao: '\u{1F376}', soya: '\u{1F376}',
  sal: '\u{1F9C2}', azucar: '\u{1F36C}', panela: '\u{1F36C}', chancaca: '\u{1F36C}',
  miel: '\u{1F36F}', algarrobina: '\u{1F36F}',
  ajo: '\u{1F9C4}', comino: '\u{1F9C2}', pimienta: '\u{1F9C2}', oregano: '\u{1F33F}',
  culantro: '\u{1F33F}', cilantro: '\u{1F33F}', perejil: '\u{1F33F}', huacatay: '\u{1F33F}',
  paico: '\u{1F33F}', hierbabuena: '\u{1F33F}', albahaca: '\u{1F33F}', laurel: '\u{1F33F}',
  canela: '\u{1FAB5}', clavo: '\u{1F330}', kion: '\u{1FADA}', jengibre: '\u{1FADA}',
  achiote: '\u{1F336}', aji: '\u{1F336}', pimiento: '\u{1FAD1}', rocoto: '\u{1F336}', paprika: '\u{1F336}',
  papa: '\u{1F954}', papas: '\u{1F954}', camote: '\u{1F360}', yuca: '\u{1F954}', olluco: '\u{1F954}',
  zapallo: '\u{1F383}', calabaza: '\u{1F383}',
  cebolla: '\u{1F9C5}', tomate: '\u{1F345}', zanahoria: '\u{1F955}', lechuga: '\u{1F96C}',
  espinaca: '\u{1F96C}', acelga: '\u{1F96C}', brocoli: '\u{1F966}', coliflor: '\u{1F966}',
  apio: '\u{1F96C}', poro: '\u{1F96C}', pepino: '\u{1F952}', vainitas: '\u{1FAD8}', vainita: '\u{1FAD8}',
  esparragos: '\u{1F96C}', alcachofa: '\u{1F96C}',
  champinones: '\u{1F344}', champinon: '\u{1F344}', hongos: '\u{1F344}',
  aceitunas: '\u{1FAD2}', aceituna: '\u{1FAD2}',
  frejoles: '\u{1FAD8}', frejol: '\u{1FAD8}', frijoles: '\u{1FAD8}', frijol: '\u{1FAD8}',
  lentejas: '\u{1FAD8}', lenteja: '\u{1FAD8}', garbanzos: '\u{1FAD8}', pallares: '\u{1FAD8}',
  habas: '\u{1FAD8}', haba: '\u{1FAD8}', arvejas: '\u{1FAD8}', arveja: '\u{1FAD8}',
  alverjas: '\u{1FAD8}', alverja: '\u{1FAD8}', guisantes: '\u{1FAD8}', tarwi: '\u{1FAD8}', chocho: '\u{1FAD8}',
  limon: '\u{1F34B}', naranja: '\u{1F34A}', mandarina: '\u{1F34A}', manzana: '\u{1F34E}',
  pera: '\u{1F350}', platano: '\u{1F34C}', palta: '\u{1F951}', papaya: '\u{1F348}',
  mango: '\u{1F96D}', pina: '\u{1F34D}', uva: '\u{1F347}', uvas: '\u{1F347}',
  fresa: '\u{1F353}', fresas: '\u{1F353}', arandano: '\u{1FAD0}', arandanos: '\u{1FAD0}',
  sandia: '\u{1F349}', melon: '\u{1F348}', durazno: '\u{1F351}', membrillo: '\u{1F350}',
  maracuya: '\u{1F96D}', granadilla: '\u{1F96D}', lucuma: '\u{1F96D}', chirimoya: '\u{1F348}', coco: '\u{1F965}',
  pollo: '\u{1F357}', gallina: '\u{1F357}', pechuga: '\u{1F357}', pavo: '\u{1F357}',
  pato: '\u{1F986}', cuy: '\u{1F439}', conejo: '\u{1F430}',
  carne: '\u{1F969}', res: '\u{1F969}', lomo: '\u{1F969}', bistec: '\u{1F969}',
  cerdo: '\u{1F953}', chancho: '\u{1F953}', tocino: '\u{1F953}',
  cordero: '\u{1F356}', cabrito: '\u{1F356}', higado: '\u{1F356}', sangrecita: '\u{1F356}',
  chorizo: '\u{1F32D}', jamon: '\u{1F356}',
  pescado: '\u{1F41F}', bonito: '\u{1F41F}', trucha: '\u{1F41F}', atun: '\u{1F41F}',
  cachema: '\u{1F41F}', filete: '\u{1F41F}',
  mariscos: '\u{1F990}', camarones: '\u{1F990}', langostinos: '\u{1F990}', conchas: '\u{1F9AA}',
  calamar: '\u{1F991}', pulpo: '\u{1F419}',
  huevo: '\u{1F95A}', huevos: '\u{1F95A}',
  leche: '\u{1F95B}', queso: '\u{1F9C0}', quesillo: '\u{1F9C0}', yogurt: '\u{1F95B}',
  yogur: '\u{1F95B}', crema: '\u{1F95B}', manjar: '\u{1F36E}',
  pan: '\u{1F35E}', galletas: '\u{1F36A}', galleta: '\u{1F36A}', tostadas: '\u{1F35E}',
  wonton: '\u{1F95F}', masa: '\u{1F95F}',
  nueces: '\u{1F330}', pecanas: '\u{1F330}', mani: '\u{1F95C}', almendras: '\u{1F330}', pasas: '\u{1F347}',
  agua: '\u{1F4A7}', caldo: '\u{1F372}', cafe: '\u{2615}', te: '\u{1F375}', emoliente: '\u{1F375}',
  infusion: '\u{1F375}', mate: '\u{1F375}',
  chicha: '\u{1F37A}', cerveza: '\u{1F37A}', vino: '\u{1F377}', jugo: '\u{1F9C3}',
  refresco: '\u{1F9C3}', gaseosa: '\u{1F964}',
  maca: '\u{1F330}', cacao: '\u{1F36B}', chocolate: '\u{1F36B}', gelatina: '\u{1F36E}', mazamorra: '\u{1F36E}',
};
// Frases que hay que mirar ANTES que las palabras sueltas (el termino que manda no es el primero).
const ICONO_FRASE = [['aceite de oliva', '\u{1FAD2}'], ['clavo de olor', '\u{1F330}']];

const _sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function iconoIngrediente(nombre, categoria) {
  const limpio = _sinTildes(nombre).toLowerCase().trim();
  for (const par of ICONO_FRASE) if (limpio.includes(par[0])) return par[1];
  for (const p of limpio.split(/[^a-z0-9]+/)) if (p && ICONO_ING[p]) return ICONO_ING[p];
  return (CAT_INFO[categoria] || CAT_INFO.otro).ic; // respaldo: el icono de su categoria
}

// ===== ICONO DEL PLATO =====
// Igual que arriba, derivado del nombre. Aqui gana lo MAS ESPECIFICO (el tipo de plato), asi
// que se busca por frase en un orden pensado: "arroz con pollo" es un arroz, no un pollo.
const ICONO_PLATO = [
  ['ceviche', '\u{1F41F}'], ['chaufa', '\u{1F35A}'], ['arroz', '\u{1F35A}'], ['risotto', '\u{1F35A}'],
  ['sopa', '\u{1F372}'], ['caldo', '\u{1F372}'], ['chupe', '\u{1F372}'], ['aguadito', '\u{1F372}'],
  ['menestron', '\u{1F372}'], ['crema de', '\u{1F372}'], ['locro', '\u{1F372}'],
  ['guiso', '\u{1F35B}'], ['estofado', '\u{1F35B}'], ['seco de', '\u{1F35B}'], ['adobo', '\u{1F35B}'],
  ['ensalada', '\u{1F957}'], ['causa', '\u{1F954}'], ['papa a la', '\u{1F954}'], ['papa rellena', '\u{1F954}'],
  ['tallarin', '\u{1F35D}'], ['fideos', '\u{1F35D}'], ['pasta', '\u{1F35D}'], ['lasagna', '\u{1F35D}'],
  ['tortilla', '\u{1F373}'], ['huevo', '\u{1F373}'], ['revuelto', '\u{1F373}'], ['omelette', '\u{1F373}'],
  ['sandwich', '\u{1F96A}'], ['pan con', '\u{1F96A}'], ['hamburguesa', '\u{1F354}'],
  ['empanada', '\u{1F95F}'], ['wonton', '\u{1F95F}'],
  ['avena', '\u{1F963}'], ['quinua', '\u{1F963}'], ['mazamorra', '\u{1F36E}'], ['flan', '\u{1F36E}'],
  ['postre', '\u{1F36E}'],
  ['jugo', '\u{1F9C3}'], ['refresco', '\u{1F9C3}'], ['batido', '\u{1F964}'],
  ['emoliente', '\u{1F375}'], ['infusion', '\u{1F375}'],
  ['leche', '\u{1F95B}'], ['yogurt', '\u{1F95B}'], ['queso', '\u{1F9C0}'],
  ['pollo', '\u{1F357}'], ['gallina', '\u{1F357}'], ['pato', '\u{1F986}'], ['cuy', '\u{1F439}'],
  ['pescado', '\u{1F41F}'], ['trucha', '\u{1F41F}'], ['bonito', '\u{1F41F}'], ['atun', '\u{1F41F}'],
  ['jalea', '\u{1F990}'],
  ['lomo', '\u{1F969}'], ['carne', '\u{1F969}'], ['bistec', '\u{1F969}'],
  ['cerdo', '\u{1F953}'], ['chicharron', '\u{1F953}'],
  ['anticucho', '\u{1F362}'], ['parrilla', '\u{1F356}'],
  ['lentejas', '\u{1FAD8}'], ['frejol', '\u{1FAD8}'], ['tacu', '\u{1FAD8}'],
];
const ICONO_MOMENTO = { desayuno: '\u{1F963}', almuerzo: '\u{1F35B}', cena: '\u{1F37D}️' };
function iconoPlato(nombre, momento) {
  const limpio = _sinTildes(nombre).toLowerCase();
  for (const par of ICONO_PLATO) if (limpio.includes(par[0])) return par[1];
  return ICONO_MOMENTO[momento] || '\u{1F37D}️';
}

// ===== Mascota: se puede ARRASTRAR y CERRAR; la decision se recuerda por dispositivo =====
//
// Portado de NutriIA. El chef es simpatico pero tapa contenido en pantallas chicas, y antes no
// habia forma de quitarlo: era `pointer-events:none`, decorativo y fijo abajo a la derecha.
//
// La preferencia (posicion y si esta oculta) vive en localStorage, o sea POR DISPOSITIVO y no
// por cuenta: donde estorba es en el telefono, y ahi es donde se quiere mover. Guardarlo en el
// servidor obligaria a sincronizar algo que no lo necesita.
const MASCOTA_KEY = 'nutrichefia_mascota';
function _leerPrefsMascota() { try { return JSON.parse(localStorage.getItem(MASCOTA_KEY)) || {}; } catch { return {}; } }
function _guardarPrefsMascota(p) {
  try { localStorage.setItem(MASCOTA_KEY, JSON.stringify({ ..._leerPrefsMascota(), ...p })); } catch { /* modo privado */ }
}
(function mascotaMovible() {
  const img = document.querySelector('img.mascota');
  if (!img) return;

  // Se envuelve en una caja para poder colgarle el boton de cerrar.
  const caja = document.createElement('div');
  caja.className = 'mascota-caja';
  img.parentNode.insertBefore(caja, img);
  caja.appendChild(img);

  const cerrar = document.createElement('button');
  cerrar.className = 'mascota-cerrar';
  cerrar.type = 'button';
  cerrar.title = 'Ocultar el chef';
  cerrar.setAttribute('aria-label', 'Ocultar el chef');
  cerrar.textContent = '×';
  caja.appendChild(cerrar);

  const volver = document.createElement('button');
  volver.className = 'mascota-volver hidden';
  volver.type = 'button';
  volver.textContent = '\u{1F468}‍\u{1F373} Mostrar chef';
  document.body.appendChild(volver);

  const prefs = _leerPrefsMascota();

  // Mantiene la caja dentro de la pantalla (por si cambia el tamano o se gira el telefono).
  function ubicar(x, y) {
    const r = caja.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - r.width);
    const maxY = Math.max(0, window.innerHeight - r.height);
    const px = Math.min(Math.max(0, x), maxX);
    const py = Math.min(Math.max(0, y), maxY);
    caja.style.left = px + 'px';
    caja.style.top = py + 'px';
    caja.style.right = 'auto';
    caja.style.bottom = 'auto';
    return { x: px, y: py };
  }
  function aplicarVisibilidad(oculta) {
    caja.classList.toggle('hidden', oculta);
    volver.classList.toggle('hidden', !oculta);
  }

  if (typeof prefs.x === 'number' && typeof prefs.y === 'number') {
    requestAnimationFrame(() => ubicar(prefs.x, prefs.y));
  }
  aplicarVisibilidad(!!prefs.oculta);

  cerrar.onclick = () => { aplicarVisibilidad(true); _guardarPrefsMascota({ oculta: true }); };
  volver.onclick = () => { aplicarVisibilidad(false); _guardarPrefsMascota({ oculta: false }); };

  // Arrastre con pointer events: sirve igual para raton y para dedo, sin duplicar handlers.
  let arrastrando = false;
  let dx = 0;
  let dy = 0;
  img.addEventListener('pointerdown', (e) => {
    const r = caja.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    arrastrando = true;
    caja.classList.add('arrastrando');
    img.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  img.addEventListener('pointermove', (e) => { if (arrastrando) ubicar(e.clientX - dx, e.clientY - dy); });
  const soltar = (e) => {
    if (!arrastrando) return;
    arrastrando = false;
    caja.classList.remove('arrastrando');
    try { img.releasePointerCapture(e.pointerId); } catch { /* ya se solto */ }
    const r = caja.getBoundingClientRect();
    _guardarPrefsMascota({ x: Math.round(r.left), y: Math.round(r.top) });
  };
  img.addEventListener('pointerup', soltar);
  img.addEventListener('pointercancel', soltar);
  // Si la ventana cambia de tamano, se vuelve a encajar dentro de la pantalla.
  window.addEventListener('resize', () => {
    if (caja.style.left) ubicar(parseFloat(caja.style.left), parseFloat(caja.style.top));
  });
})();
