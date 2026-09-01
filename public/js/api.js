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
  if (admin && u.rol !== 'admin') { location.href = '/inicio.html'; return null; }
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
    { id: 'inicio', href: '/inicio.html', ic: '🏠', txt: 'Inicio' },
    { id: 'analizar', href: '/app.html', ic: '🔍', txt: 'Analizar producto' },
  ];
  if (u?.incluye_planificador) {
    items.push({ id: 'plan', href: '/plan.html', ic: '📅', txt: 'Plan de comidas' });
    // La despensa es un modulo OPCIONAL: si el hogar no la activo, no se ofrece.
    if (u.despensa_activa) items.push({ id: 'despensa', href: '/despensa.html', ic: '🛒', txt: 'Mi despensa' });
    items.push({ id: 'platos', href: '/platos.html', ic: '🍲', txt: 'Mis Recetas' });
    // "Mis compras" NO depende de la despensa: llevar la cuenta de lo que gastas es util
    // aunque no lleves inventario.
    items.push({ id: 'compras', href: '/compras.html', ic: '🧾', txt: 'Mis compras' });
    // "Analisis" mira hacia ATRAS (que se comio y como estuvo); "Analizar producto" es el
    // escaner de un producto suelto. Van separados en el menu por eso mismo.
    items.push({ id: 'analisis', href: '/analisis.html', ic: '📊', txt: 'Análisis' });
    items.push({ id: 'hogar', href: '/hogar.html', ic: '👨‍👩‍👧', txt: 'Mi hogar' });
  }
  items.push({ id: 'suscripcion', href: '/mi-plan.html', ic: '💳', txt: 'Mi suscripción' });
  if (!esAdmin) items.push({ id: 'soporte', href: '/soporte.html', ic: '💬', txt: 'Soporte' });
  if (esAdmin) items.push({ id: 'admin', href: '/admin.html', ic: '🛠️', txt: 'Panel admin' });

  const nav = items.map((i) =>
    `<a href="${i.href}" class="${i.id === seccionActiva ? 'active' : ''}"><span class="ic">${i.ic}</span>${i.txt}</a>`
  ).join('');

  return `
    <div class="brand"><img src="/img/logo.png?v=2" alt="NutriChefIA" class="brand-logo" /></div>
    <nav class="nav">${nav}</nav>
    <div class="sidebar-foot">
      <button type="button" class="userbox-btn" title="Ver y editar mi perfil">
        <div class="userbox">
          <div class="avatar">${u?.foto ? `<img src="${u.foto}" alt="" />` : iniciales(u?.nombre)}</div>
          <div class="meta"><b>${u?.nombre || ''}</b><span>${u?.rol === 'admin' ? 'Administrador' : ('Plan ' + (u?.plan_nombre || 'Free'))}</span></div>
        </div>
      </button>
      <button class="btn btn-block btn-sm" style="background:var(--logo-green);color:#fff" onclick="Sesion.cerrar(); location.href='/index.html'">Cerrar sesion</button>
    </div>`;
}

// Una tarjeta de dato como las del dashboard. Vive aqui porque la usan varias secciones y
// porque el color de cada una tiene que ser EL MISMO que en inicio: "Recetas" es naranja en las
// dos pantallas o el color deja de significar nada.
//   accion: si se pasa, la tarjeta es pulsable (un boton, no un enlace: suele filtrar en sitio).
function tarjetaDato({ ic, valor, txt, sub, tono = 'verde', href, accion }) {
  const cuerpo = `<span class="stat-ic">${ic}</span>
    <b class="stat-valor">${valor}</b>
    <span class="stat-txt">${txt}</span>
    ${sub ? `<span class="stat-sub">${sub}</span>` : ''}`;
  if (href) return `<a class="stat-card tono-${tono}" href="${href}">${cuerpo}</a>`;
  if (accion) return `<button type="button" class="stat-card tono-${tono}" data-dato="${accion}" style="text-align:left;cursor:pointer">${cuerpo}</button>`;
  return `<div class="stat-card tono-${tono}">${cuerpo}</div>`;
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
  aceite: '\u{1F9F4}', mantequilla: '\u{1F9C8}', margarina: '\u{1F9C8}',
  vinagre: '\u{1F376}', salsa: '\u{1F376}', sillao: '\u{1F376}', soya: '\u{1F376}',
  sal: '\u{1F9C2}', azucar: '\u{1F36C}', panela: '\u{1F36C}', chancaca: '\u{1F36C}',
  miel: '\u{1F36F}', algarrobina: '\u{1F36F}',
  ajo: '\u{1F9C4}', comino: '\u{1F9C2}', pimienta: '\u{1F9C2}', oregano: '\u{1F33F}',
  culantro: '\u{1F33F}', cilantro: '\u{1F33F}', perejil: '\u{1F33F}', huacatay: '\u{1F33F}',
  paico: '\u{1F33F}', hierbabuena: '\u{1F33F}', albahaca: '\u{1F33F}', laurel: '\u{1F33F}',
  canela: '\u{1F9C2}', clavo: '\u{1F330}', kion: '\u{1F33F}', jengibre: '\u{1F33F}',
  achiote: '\u{1F336}', aji: '\u{1F336}', pimiento: '\u{1F336}', rocoto: '\u{1F336}', paprika: '\u{1F336}',
  papa: '\u{1F954}', papas: '\u{1F954}', camote: '\u{1F360}', yuca: '\u{1F954}', olluco: '\u{1F954}',
  zapallo: '\u{1F383}', calabaza: '\u{1F383}',
  cebolla: '\u{1F9C5}', tomate: '\u{1F345}', zanahoria: '\u{1F955}', lechuga: '\u{1F96C}',
  espinaca: '\u{1F96C}', acelga: '\u{1F96C}', brocoli: '\u{1F966}', coliflor: '\u{1F966}',
  apio: '\u{1F96C}', poro: '\u{1F96C}', pepino: '\u{1F952}', vainitas: '\u{1F96B}', vainita: '\u{1F96B}',
  esparragos: '\u{1F96C}', alcachofa: '\u{1F96C}',
  champinones: '\u{1F344}', champinon: '\u{1F344}', hongos: '\u{1F344}',
  frejoles: '\u{1F96B}', frejol: '\u{1F96B}', frijoles: '\u{1F96B}', frijol: '\u{1F96B}',
  lentejas: '\u{1F96B}', lenteja: '\u{1F96B}', garbanzos: '\u{1F96B}', pallares: '\u{1F96B}',
  habas: '\u{1F96B}', haba: '\u{1F96B}', arvejas: '\u{1F96B}', arveja: '\u{1F96B}',
  alverjas: '\u{1F96B}', alverja: '\u{1F96B}', guisantes: '\u{1F96B}', tarwi: '\u{1F96B}', chocho: '\u{1F96B}',
  limon: '\u{1F34B}', naranja: '\u{1F34A}', mandarina: '\u{1F34A}', manzana: '\u{1F34E}',
  pera: '\u{1F350}', platano: '\u{1F34C}', palta: '\u{1F951}', papaya: '\u{1F348}',
  mango: '\u{1F96D}', pina: '\u{1F34D}', uva: '\u{1F347}', uvas: '\u{1F347}',
  fresa: '\u{1F353}', fresas: '\u{1F353}', arandano: '\u{1F347}', arandanos: '\u{1F347}',
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
const ICONO_FRASE = [['clavo de olor', '\u{1F330}']];

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
  ['lentejas', '\u{1F96B}'], ['frejol', '\u{1F96B}'], ['tacu', '\u{1F96B}'],
];
const ICONO_MOMENTO = { desayuno: '\u{1F963}', almuerzo: '\u{1F35B}', cena: '\u{1F37D}️' };
function iconoPlato(nombre, momento) {
  const limpio = _sinTildes(nombre).toLowerCase();
  for (const par of ICONO_PLATO) if (limpio.includes(par[0])) return par[1];
  return ICONO_MOMENTO[momento] || '\u{1F37D}️';
}

// ===== APORTE NUTRICIONAL DEL PLATO (platos.info) =====
//
// Vive aqui y no en plan.html porque lo pintan DOS pantallas sobre la MISMA fila de la BD: el
// calendario y "Mis Recetas". Con una copia en cada una, completar un plato desde el plan
// (POST /api/plan/detallar escribe en `platos`) dejaba a la biblioteca mostrando la version
// vieja del mismo plato — que es justo lo que se reporto.
// ===== Aporte nutricional (plato.info) =====
// El semaforo usa las mismas clases del escaner. Ojo: la BD dice "ambar" y la clase
// del CSS se llama "amarillo" (viene del escaner) — de ahi el mapeo.
const SEM_CLASE = { verde: 'sem-verde-bn', ambar: 'sem-amarillo-bn', rojo: 'sem-rojo-bn' };
const SEM_TXT = { verde: 'Saludable', ambar: 'Ocasional', rojo: 'No le conviene' };
const MACRO_TXT = { alto: 'alto', medio: 'medio', bajo: 'bajo' };

// Tag compacto para la casilla: punto de color + kcal. Si la IA no dio semaforo pero
// si calorias (o al reves), se pinta lo que haya en vez de no pintar nada.
function tagNutri(info) {
  if (!info) return '';
  const clase = SEM_CLASE[info.semaforo] || '';
  const kcal = info.calorias ? `${info.calorias} kcal` : (SEM_TXT[info.semaforo] || '');
  if (!clase && !kcal) return '';
  const titulo = [SEM_TXT[info.semaforo], info.resumen].filter(Boolean).join(' · ');
  return `<span class="tag ${clase}" title="${esc(titulo)}">${clase ? '<span class="sem-dot"></span>' : ''}${esc(kcal)}</span>`;
}

// Bloque completo para el modal: semaforo + macros + micronutrientes + resumen.
// Si el plato aun no tiene info (lo genero un menu viejo), invita a analizarlo.
function bloqueNutri(info) {
  cargarIntegrantes();
  if (!info) {
    return `<div class="reco-foto" style="margin-top:12px">
      🥗 Este plato todavía no tiene su información nutricional.
      La completas desde <b>Plan de comidas</b>, con el botón <b>“🍳 Completar recetas”</b>.
    </div>`;
  }
  const macro = (etiqueta, nivel) =>
    nivel ? `<span class="tag">${etiqueta}: ${MACRO_TXT[nivel] || nivel}</span>` : '';
  const macros = [
    macro('Carbohidratos', info.carbohidratos),
    macro('Proteínas', info.proteinas),
    macro('Grasas', info.grasas),
  ].filter(Boolean).join('');

  const clase = SEM_CLASE[info.semaforo] || '';
  const banner = info.semaforo
    ? `<div class="sem-banner ${clase}" style="margin-bottom:10px">
         <span class="sem-dot"></span>
         <span>${SEM_TXT[info.semaforo]}${info.calorias ? ` · ~${info.calorias} kcal por porción` : ''}</span>
       </div>`
    : (info.calorias ? `<p style="font-size:13px;margin-bottom:10px"><b>~${info.calorias} kcal</b> por porción</p>` : '');

  // Barras horizontales con el % del valor diario. La barra mide el %VD (no el valor
  // absoluto): son unidades distintas —gramos, miligramos— y pintarlas en la misma escala
  // haria que 581 mg de sodio se viera 20 veces mas "grande" que 29 g de proteina.
  // Se topa en 100 para que un nutriente pasado de rosca no rompa la fila, pero el numero
  // real se sigue mostrando al lado.
  const NUTRI_TXT = {
    carbohidratos: ['Carbohidratos', 'g'], proteinas: ['Proteína', 'g'], grasas: ['Grasas', 'g'],
    fibra: ['Fibra', 'g'], hierro: ['Hierro', 'mg'], sodio: ['Sodio', 'mg'], sal: ['Eq. de sal', 'g'],
  };
  // Sodio y sal en exceso importan mas que el resto en un hogar con hipertension: por
  // encima del 20% del valor diario se pintan en ambar y por encima del 40% en rojo.
  const tonoNutri = (clave, vd) => {
    if (vd == null) return '';
    if ((clave === 'sodio' || clave === 'sal') && vd >= 40) return ' barra-alta';
    if ((clave === 'sodio' || clave === 'sal') && vd >= 20) return ' barra-media';
    return '';
  };
  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

  const filas = [];
  if (info.calorias) {
    filas.push({ txt: 'Energía', uni: 'kcal', v: info.calorias, vd: info.calorias_vd, clave: 'energia' });
  }
  for (const [clave, [txt, uni]] of Object.entries(NUTRI_TXT)) {
    const n = info.nutrientes && info.nutrientes[clave];
    if (n) filas.push({ txt, uni, v: n.v, vd: n.vd, clave });
  }
  // Cada fila es pulsable y explica ESE nutriente: que es, que significa su numero y a
  // quien de la familia le importa. La etiqueta entera es el boton (no solo el icono) para
  // que se vea que hay algo que tocar y para que el area de toque sirva en el telefono.
  const tabla = filas.length
    ? `<div class="nutri-tabla">${filas.map((f) => `
        <div class="nutri-fila">
          <button type="button" class="nutri-txt nutri-info" data-nutri="${f.clave}"
            data-v="${f.v}" data-uni="${f.uni}" data-vd="${f.vd == null ? '' : f.vd}"
            title="¿Qué significa este número?">${f.txt} <span class="nutri-ic" aria-hidden="true">i</span></button>
          <span class="nutri-val">${fmtNum(f.v)} <span class="nutri-uni">${f.uni}</span></span>
          <span class="nutri-barra"><i style="width:${Math.max(2, Math.min(100, f.vd ?? 0))}%" class="${tonoNutri(f.clave, f.vd)}"></i></span>
          <span class="nutri-vd">${f.vd == null ? '' : f.vd + '%'}</span>
        </div>`).join('')}</div>`
    : '';

  // Los platos generados antes de este formato no traen numeros: se sigue mostrando lo que
  // si tienen (las etiquetas alto/medio/bajo) en vez de dejar el bloque vacio.
  const sinNumeros = !filas.length && macros;

  // Las recomendaciones por integrante van PRIMERO y en su propia caja: en un hogar con
  // diabetes o hipertension es lo mas importante de esta pantalla, y perdidas entre los
  // numeros no se leen.
  const recos = (info.recomendaciones || []).length
    ? `<div class="nutri-recos">
         <b>👨‍👩‍👧 Para tu familia</b>
         <ul>${info.recomendaciones.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
       </div>`
    : '';

  return `<div class="nutri-caja">
    <div class="nutri-cab">
      <b>🥗 Aporte nutricional</b>
      <span class="muted">por porción</span>
    </div>
    ${banner}
    ${recos}
    ${tabla}
    ${sinNumeros ? `<div class="row" style="gap:5px;flex-wrap:wrap;margin:8px 0">${macros}</div>` : ''}
    ${info.destacados?.length
      ? `<p style="font-size:12.5px;margin:10px 0 0">✨ <b>Aporta:</b> ${info.destacados.map(esc).join(', ')}</p>`
      : ''}
    ${info.resumen ? `<p class="muted" style="font-size:12.5px;margin-top:6px">${esc(info.resumen)}</p>` : ''}
    <p class="muted" style="font-size:11.5px;margin-top:10px">
      👆 Toca cualquier nutriente para saber qué es y qué significa su número.<br />
      🥗 Estimación orientativa por porción; el % es sobre un valor diario de referencia de
      2000 kcal. No reemplaza la consulta con un nutricionista.
    </p>
  </div>`;
}

// ===== Que significa cada nutriente =====
//
// Se explica AQUI, en el navegador, y no se le pide a la IA: es lo mismo para todos los
// platos, asi que pedirlo seria pagar una y otra vez por el mismo texto (y arriesgar que
// salga distinto en cada plato). Lo unico que cambia por hogar son las condiciones medicas,
// y esas ya las tenemos.
//
// "mas es mejor" (fibra, hierro, proteina) vs. "cuidar el exceso" (sodio, grasas...): sin
// esa distincion, un 30% de fibra y un 30% de sodio se leerian igual, y no son lo mismo.
const NUTRI_GUIA = {
  energia: {
    ic: '🔥', nombre: 'Energía (calorías)', masEsMejor: false,
    que: 'Es el combustible que le da al cuerpo una porción de este plato. Una persona adulta necesita alrededor de 2000 calorías al día repartidas entre todas sus comidas.',
    exceso: 'Comer más calorías de las que se gastan es lo que hace subir de peso.',
    ojo: [
      { claves: ['diabetes'], txt: 'con diabetes conviene mantener porciones parejas entre un día y otro, para que el azúcar no suba y baje de golpe' },
      { claves: ['sobrepeso', 'obesidad'], txt: 'si se está bajando de peso, este es el número que más conviene mirar' },
    ],
  },
  carbohidratos: {
    ic: '🍚', nombre: 'Carbohidratos', masEsMejor: false,
    que: 'Son el arroz, la papa, el camote, los fideos, el pan y los azúcares. Es de donde el cuerpo saca la energía del día a día.',
    exceso: 'Dentro del cuerpo se convierten en glucosa, o sea azúcar en la sangre. Cuanto más grande la porción, más sube.',
    ojo: [
      { claves: ['diabetes'], txt: 'es EL número a vigilar: mide la porción y acompáñalos con verduras y proteína, que hacen que el azúcar entre más despacio' },
      { claves: ['sobrepeso', 'obesidad'], txt: 'suelen ser la parte más fácil de recortar del plato' },
    ],
  },
  proteinas: {
    ic: '🍗', nombre: 'Proteínas', masEsMejor: true,
    que: 'Vienen de la carne, el pescado, el huevo, la leche y las menestras. Sirven para mantener y reparar los músculos y para las defensas.',
    exceso: '',
    ojo: [
      { claves: ['anemia'], txt: 'las carnes y la sangrecita aportan proteína y hierro a la vez' },
      { claves: ['renal', 'riñon', 'rinon'], txt: 'con problemas del riñón el exceso de proteína sí importa: consúltalo con su médico' },
    ],
  },
  grasas: {
    ic: '🫗', nombre: 'Grasas', masEsMejor: false,
    que: 'Son el aceite, la mantequilla, las frituras y la grasa propia de las carnes. Dan energía y ayudan a aprovechar algunas vitaminas.',
    exceso: 'De más suben el colesterol y cargan el corazón. No es lo mismo el aceite de oliva o la palta que la fritura.',
    ojo: [
      { claves: ['colesterol'], txt: 'es el número que le pidieron cuidar' },
      { claves: ['hipertension', 'presion alta', 'corazon'], txt: 'la grasa y el sodio juntos son los que más cargan al corazón' },
      { claves: ['sobrepeso', 'obesidad'], txt: 'es lo que más calorías aporta por bocado' },
    ],
  },
  fibra: {
    ic: '🥬', nombre: 'Fibra', masEsMejor: true,
    que: 'Está en las verduras, las frutas con cáscara, las menestras y los granos integrales. El cuerpo no la digiere, y por eso ayuda a ir al baño con regularidad.',
    exceso: '',
    ojo: [
      { claves: ['diabetes'], txt: 'es una buena aliada: hace que el azúcar del plato entre más lento a la sangre' },
      { claves: ['estreñimiento', 'estrenimiento', 'colon'], txt: 'es justo lo que le hace falta, y acompañada de bastante agua' },
    ],
  },
  hierro: {
    ic: '🩸', nombre: 'Hierro', masEsMejor: true,
    que: 'Está en la sangrecita, el hígado, las carnes rojas y las menestras. Es lo que lleva el oxígeno por la sangre.',
    exceso: 'Cuando falta aparece la anemia: cansancio, sueño y falta de concentración. Acompañarlo con limón o fruta cítrica ayuda a aprovecharlo mejor.',
    ojo: [
      { claves: ['anemia'], txt: 'es EL número a vigilar en esta familia' },
      { claves: ['embarazo', 'gestante'], txt: 'en el embarazo hace falta bastante más de lo normal' },
    ],
  },
  sodio: {
    ic: '🧂', nombre: 'Sodio', masEsMejor: false,
    que: 'Viene sobre todo de la sal, pero también del cubito, la sillao, los embutidos y las conservas. El cuerpo lo necesita en poca cantidad.',
    exceso: 'De más hace retener líquidos y sube la presión arterial.',
    ojo: [
      { claves: ['hipertension', 'presion alta'], txt: 'es EL número a vigilar: cambia el cubito y la sillao por ajo, cebolla, culantro y limón' },
      { claves: ['renal', 'riñon', 'rinon', 'corazon'], txt: 'con problemas de riñón o del corazón hay que bajarlo aún más' },
    ],
  },
  sal: {
    ic: '🥄', nombre: 'Equivalente en sal', masEsMejor: false,
    que: 'Es el mismo sodio de la fila anterior, pero contado como sal de mesa, que es como uno la ve en la cocina. Una cucharadita rasa son unos 5 gramos.',
    exceso: 'La recomendación general es no pasar de una cucharadita de sal en TODO el día, sumando lo que ya traen los alimentos.',
    ojo: [
      { claves: ['hipertension', 'presion alta'], txt: 'de aquí sale la indicación de "baja la sal" que le dieron' },
    ],
  },
};

// Los integrantes del hogar, para poder decir A QUIEN le importa cada nutriente por su
// nombre. Se pide una vez y en segundo plano: si falla, las explicaciones siguen saliendo
// (sin la parte de la familia), que es mejor que no explicar nada.
// Se pide PEREZOSAMENTE, la primera vez que se pinta un aporte nutricional: api.js se carga en
// todas las paginas y pedirlo al arrancar seria una peticion de mas en las que no muestran
// ningun plato (y un 403 seguro en las cuentas sin planificador). Cuando el usuario toque un
// nutriente ya habra llegado.
let INTEGRANTES = [];
let _integrantes = null;   // la peticion en vuelo, para no dispararla dos veces
function cargarIntegrantes() {
  if (!Sesion.token) return Promise.resolve();
  if (!_integrantes) {
    _integrantes = api('/api/hogar')
      .then((h) => { INTEGRANTES = h.integrantes || []; })
      .catch(() => { /* sin la parte de la familia, pero la explicacion sale igual */ });
  }
  return _integrantes;
}

const sinTildes = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Quien de la familia tiene alguna de esas condiciones.
function quienesTienen(claves) {
  return INTEGRANTES.filter((i) => (i.condiciones || []).some((c) => {
    const t = sinTildes(c);
    return claves.some((k) => t.includes(sinTildes(k)));
  })).map((i) => i.nombre);
}

// La regla del 5 y el 20 (la que usan las tablas nutricionales): por debajo del 5% del
// valor diario el aporte es bajo; del 20% para arriba es alto. Sirve para los dos sentidos,
// solo cambia si eso es una buena o una mala noticia.
function lecturaVD(vd, masEsMejor) {
  if (vd == null || !Number.isFinite(vd)) return null;
  if (vd < 5) return masEsMejor
    ? { txt: 'Aporte bajo', det: 'Este plato casi no lo aporta; búscalo en otra comida del día.', tono: 'ambar' }
    : { txt: 'Aporte bajo', det: 'Una cantidad pequeña dentro de todo el día.', tono: 'verde' };
  if (vd < 20) return { txt: 'Aporte moderado', det: 'Una parte razonable de lo del día.', tono: 'verde' };
  return masEsMejor
    ? { txt: 'Aporte alto', det: 'Con una porción cubres buena parte de lo del día. Buena noticia.', tono: 'verde' }
    : { txt: 'Aporte alto', det: 'Una sola porción se lleva buena parte de lo de todo el día. Conviene no repetirlo en la cena.', tono: 'ambar' };
}

// Modal de un nutriente. No usa IA: se arma con la guia de arriba + las condiciones del hogar.
async function explicarNutriente(clave, valor, unidad, vd) {
  const g = NUTRI_GUIA[clave];
  if (!g) return;
  await cargarIntegrantes();   // sin esto, un clic muy rapido salia sin nombrar a la familia
  const lec = lecturaVD(vd, g.masEsMejor);
  const avisos = (g.ojo || [])
    .map((o) => ({ nombres: quienesTienen(o.claves), txt: o.txt }))
    .filter((o) => o.nombres.length);

  const back = document.createElement('div');
  back.className = 'modal-back show';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:480px;text-align:left">
    <h3>${g.ic} ${esc(g.nombre)}</h3>
    <div class="modal-body">
      <div class="nutri-dato">
        <b>${esc(String(valor))} ${esc(unidad)}</b> por porción
        ${vd !== '' && vd != null ? `<span class="nutri-dato-vd">${vd}% de lo del día</span>` : ''}
      </div>
      ${lec ? `<p class="nutri-lectura ${lec.tono}"><b>${lec.txt}.</b> ${lec.det}</p>` : ''}
      <p style="font-size:13px;line-height:1.6;margin-bottom:10px"><b>¿Qué es?</b> ${esc(g.que)}</p>
      ${g.exceso ? `<p style="font-size:13px;line-height:1.6;margin-bottom:10px">${esc(g.exceso)}</p>` : ''}
      ${avisos.length ? `<div class="nutri-recos" style="margin:12px 0">
          <b>👨‍👩‍👧 En tu familia</b>
          <ul>${avisos.map((a) => `<li><b>${a.nombres.map(esc).join(' y ')}</b>: ${esc(a.txt)}.</li>`).join('')}</ul>
        </div>` : ''}
      <p class="muted" style="font-size:11.5px;line-height:1.55;margin-top:12px">
        De dónde sale el número: lo estima la IA a partir de los ingredientes del plato y del
        número de porciones. Es una orientación, no un análisis de laboratorio, y no reemplaza
        lo que le indique su médico o nutricionista.
      </p>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-sm" type="button" data-cerrar>Entendido</button></div>
  </div>`;
  document.body.appendChild(back);
  const cerrar = () => back.remove();
  back.querySelector('[data-cerrar]').onclick = cerrar;
  back.onclick = (e) => { if (e.target === back) cerrar(); };
}

// Delegado en el documento: el bloque nutricional vive dentro de un modal que se crea y se
// destruye, asi que enganchar el listener a ese modal obligaria a repetirlo en cada sitio
// que lo abre.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nutri]');
  if (!b) return;
  explicarNutriente(b.dataset.nutri, b.dataset.v, b.dataset.uni,
    b.dataset.vd === '' ? null : Number(b.dataset.vd));
});

// ===== Mascota: el chef ACOMPANA Y EXPLICA. Se puede arrastrar y cerrar =====
//
// Portado de NutriIA como adorno, hoy hace un trabajo: en cada pantalla saca un GLOBO DE
// DIALOGO (verde del logo, letra blanca) que dice en una frase para que sirve la seccion en la
// que esta el usuario. Es la ayuda mas barata que hay: no ocupa sitio en el layout, esta en
// todas las pantallas y se puede callar de un toque.
//
// SE PINTA DESDE AQUI, no desde cada HTML. Antes cada pagina llevaba su <img class="mascota">
// y cuatro no lo llevaban, asi que el chef desaparecia al entrar en Mi hogar, Mi suscripcion,
// Soporte o el panel admin. Con una sola tabla por ruta no puede haber una pantalla sin chef,
// ni dos mensajes distintos para la misma seccion.
//
// La preferencia (posicion, si esta oculta y si el globo esta callado) vive en localStorage,
// o sea POR DISPOSITIVO y no por cuenta: donde estorba es en el telefono, y ahi es donde se
// quiere mover. Guardarlo en el servidor obligaria a sincronizar algo que no lo necesita.
const MASCOTA_KEY = 'nutrichefia_mascota';

// QUE CHEF SALE EN CADA PANTALLA.
//
// Los archivos se llaman por lo que el chef LLEVA EN LA MANO (bolsa, libro, canasta...), no por
// la seccion en la que salen: la seccion se decide aqui y cambia, el dibujo no. Con nombres de
// seccion, mover el chef de la bolsa de "plan" a "compras" dejaba un mascota-plan.png saliendo
// en Mis compras, que es peor que no tener convencion.
//
// Sin entrada en esta tabla se cae al que saluda: una seccion nueva nunca se queda sin chef.
// mascota-olla.png existe y NO se usa: es media figura sobre una cocina, asi que al lado de los
// demas (todos de cuerpo entero) se ve de otro tamano aunque midan igual. Se conserva por si
// hace falta en otro sitio.
const MASCOTA_IMG = {
  inicio: 'mascota-saluda.png',      // te recibe, con el dedo en alto
  hogar: 'mascota-saluda.png',       // "cuentame quienes viven en casa"
  app: 'mascota-brazos.png',         // de brazos cruzados: "a ver, dejame verlo"
  soporte: 'mascota-brazos.png',     // "te escucho"
  plan: 'mascota-cuchara.png',       // cuchara de palo: lo que se va a cocinar
  despensa: 'mascota-canasta.png',   // canasta de verduras: lo que hay en casa
  compras: 'mascota-bolsa.png',      // bolsa del mercado: lo que traes
  platos: 'mascota-libro.png',       // el recetario
  analisis: 'mascota-checklist.png', // el informe de lo que se comio
  admin: 'mascota-checklist.png',    // el panel de control
  'mi-plan': 'mascota-festejo.png',  // celebrando: es la pantalla de pasar a Premium
};

// Lo que dice el chef en cada seccion: UNA frase, sin tecnicismos, contando que se hace ahi.
// Sin mensaje no hay globo (mejor callado que decir una obviedad).
const MASCOTA_MENSAJE = {
  inicio: ['Inicio', 'Aquí ves de un vistazo lo que toca comer hoy, cómo va tu semana y cuánto has usado la app. Toca una tarjeta para ir a esa sección.'],
  app: ['Analizar producto', 'Sácale una foto a un producto o escribe su nombre y te digo con un semáforo si le conviene a tu familia.'],
  plan: ['Plan de comidas', 'Tu calendario de la semana: desayuno, almuerzo y cena. Pulsa "Generar" y te propongo platos con lo que ya tienes en casa.'],
  despensa: ['Mi despensa', 'Aquí llevas lo que hay en tu cocina y registras la compra del periodo. Las barras te dicen si te alcanza hasta la próxima compra.'],
  compras: ['Mis compras', 'Tu lista para el mercado: marca lo que echas al carro, anota el precio y mira cuánto llevas gastado.'],
  platos: ['Mis Recetas', 'Tu recetario. Guarda los platos que te gustaron y reutilízalos en el calendario sin gastar una generación.'],
  analisis: ['Análisis', 'Mira hacia atrás: qué comió tu familia en un periodo y qué dice eso de su alimentación.'],
  hogar: ['Mi hogar', 'Cuéntame quiénes viven en casa, sus condiciones médicas y sus alergias. Con eso adapto cada plato que te propongo.'],
  'mi-plan': ['Mi suscripción', 'Aquí ves tu plan actual, lo que incluye y cómo pasarte a Premium pagando con Yape.'],
  soporte: ['Soporte', 'Si algo no funciona o se te ocurre una mejora, escríbenos por aquí.'],
  admin: ['Panel admin', 'Desde aquí se manejan los planes, los pagos por Yape, los usuarios y la configuración de la IA.'],
};

function _rutaMascota() {
  const p = location.pathname.replace(/^\//, '').replace(/\.html$/, '');
  return p || 'inicio';
}
function _leerPrefsMascota() { try { return JSON.parse(localStorage.getItem(MASCOTA_KEY)) || {}; } catch { return {}; } }
function _guardarPrefsMascota(p) {
  try { localStorage.setItem(MASCOTA_KEY, JSON.stringify({ ..._leerPrefsMascota(), ...p })); } catch { /* modo privado */ }
}
(function mascotaMovible() {
  // El login/registro no la lleva: no hay ninguna opcion que explicar todavia.
  if (!document.querySelector('.main')) return;

  const ruta = _rutaMascota();
  // La imagen puede venir del HTML o crearse aqui; al final hay una sola, dentro de la caja.
  let img = document.querySelector('img.mascota');
  if (!img) {
    img = document.createElement('img');
    img.className = 'mascota';
    img.alt = '';
    document.body.appendChild(img);
  }
  img.src = '/img/' + (MASCOTA_IMG[ruta] || 'mascota-saluda.png');
  img.setAttribute('aria-hidden', 'true');

  // EL MISMO CHEF, EN PEQUENO Y FIJO, EN LA CABECERA DE LA SECCION. El flotante se puede
  // cerrar o arrastrar; este se queda siempre, asi que la seccion nunca pierde su personaje.
  // Se inyecta aqui y no en los nueve HTML por lo mismo que la mascota: una sola tabla decide
  // que dibujo le toca a cada pantalla, y no puede haber una cabecera con el chef de otra.
  const heroIc = document.querySelector('.hero-seccion .hero-ic');
  const heroChef = document.querySelector('.hero-saludo .hero-chef'); // el saludo de inicio
  if (heroIc || heroChef) {
    const mini = document.createElement('img');
    mini.className = 'hero-mascota';
    mini.src = img.src;
    mini.alt = '';
    mini.setAttribute('aria-hidden', 'true');
    if (heroIc) heroIc.insertAdjacentElement('afterend', mini);
    else { heroChef.textContent = ''; heroChef.appendChild(mini); }  // sustituye al emoji
  }

  // Se envuelve en una caja para poder colgarle el globo y el boton de cerrar.
  const caja = document.createElement('div');
  caja.className = 'mascota-caja';
  img.parentNode.insertBefore(caja, img);

  const msj = MASCOTA_MENSAJE[ruta];
  const globo = document.createElement('div');
  globo.className = 'mascota-globo';
  globo.title = 'Toca para callar al chef';
  if (msj) {
    globo.innerHTML = '<b>' + esc(msj[0]) + '</b>' + esc(msj[1]);
    caja.appendChild(globo);
  }

  // La figura agrupa la imagen y su boton de cerrar, para que la X quede pegada al chef y no
  // a la esquina del globo, que es mas alto.
  const figura = document.createElement('div');
  figura.className = 'mascota-fig';
  caja.appendChild(figura);
  figura.appendChild(img);

  const cerrar = document.createElement('button');
  cerrar.className = 'mascota-cerrar';
  cerrar.type = 'button';
  cerrar.title = 'Ocultar el asistente';
  cerrar.setAttribute('aria-label', 'Ocultar el asistente');
  cerrar.textContent = '×';
  figura.appendChild(cerrar);

  // EL INTERRUPTOR DEL ASISTENTE (como en MedicaIA). En movil esta SIEMPRE, porque es la
  // pantalla donde el chef estorba y la unica forma de quitarlo era una X pegada a su cabeza
  // que no todo el mundo encuentra. En escritorio solo aparece cuando el chef esta escondido:
  // con el a la vista, su X esta al alcance del raton y un boton fijo seria ruido.
  //
  // 🔴 DONDE VIVE, segun el tamano de la pantalla:
  //   - ESCRITORIO: dentro de la barra superior (que es `position: sticky`), con su etiqueta.
  //     Flotando sobre el contenido se comia los botones del final de la pagina, que es donde
  //     estan las acciones del plan.
  //   - MOVIL: el CSS lo saca de la barra (`position: fixed`) y lo deja REDONDO ABAJO A LA
  //     DERECHA, que es donde se busca con el pulgar y donde ya esta el chef. Van apilados: el
  //     boton pegado a la barra inferior y el chef encima.
  // Es un solo elemento en el DOM: dos botones para lo mismo se acaban contradiciendo.
  const volver = document.createElement('button');
  volver.className = 'mascota-volver';
  volver.type = 'button';
  const barra = document.querySelector('.topbar');
  if (barra) barra.appendChild(volver);
  else document.body.appendChild(volver);  // sin barra: flota, como respaldo

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
    volver.classList.toggle('activo', oculta);  // en escritorio solo se ve si el chef no esta
    volver.classList.toggle('apagado', oculta);
    volver.innerHTML = '<img class="mv-ic" src="' + img.src + '" alt="" aria-hidden="true">'
      + '<span class="mv-txt">Asistente</span>';
    volver.title = oculta ? 'Mostrar el asistente' : 'Ocultar el asistente';
    volver.setAttribute('aria-label', volver.title);
    volver.setAttribute('aria-pressed', String(!oculta));
  }
  // EL GLOBO ARRANCA ABIERTO: es la explicacion de la seccion, y quien entra por primera vez no
  // tiene forma de saber que el chef habla si se le toca. Solo se calla si el usuario lo cerro.
  function aplicarGlobo(callado) {
    globo.classList.toggle('hidden', !!callado || !msj);
    img.title = callado && msj ? 'Toca al chef para que te explique esta sección' : 'Arrástrame';
  }

  if (typeof prefs.x === 'number' && typeof prefs.y === 'number') {
    requestAnimationFrame(() => ubicar(prefs.x, prefs.y));
  }
  aplicarVisibilidad(!!prefs.oculta);
  aplicarGlobo(!!prefs.callado);

  cerrar.onclick = () => { aplicarVisibilidad(true); _guardarPrefsMascota({ oculta: true }); };
  volver.onclick = () => {
    const oculta = !caja.classList.contains('hidden');
    aplicarVisibilidad(oculta);
    _guardarPrefsMascota({ oculta });
  };
  globo.onclick = () => { aplicarGlobo(true); _guardarPrefsMascota({ callado: true }); };

  // Arrastre con pointer events: sirve igual para raton y para dedo, sin duplicar handlers.
  let arrastrando = false;
  let movido = false;   // distingue un ARRASTRE de un TOQUE: el toque abre o calla el globo
  let dx = 0;
  let dy = 0;
  img.addEventListener('pointerdown', (e) => {
    const r = caja.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    arrastrando = true;
    movido = false;
    caja.classList.add('arrastrando');
    img.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  img.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    const r = caja.getBoundingClientRect();
    // Umbral: un dedo nunca se queda del todo quieto, y sin el ningun toque contaria como tal.
    if (Math.abs(e.clientX - dx - r.left) > 4 || Math.abs(e.clientY - dy - r.top) > 4) movido = true;
    ubicar(e.clientX - dx, e.clientY - dy);
  });
  const soltar = (e) => {
    if (!arrastrando) return;
    arrastrando = false;
    caja.classList.remove('arrastrando');
    try { img.releasePointerCapture(e.pointerId); } catch { /* ya se solto */ }
    if (!movido) {   // fue un toque, no un arrastre: el chef vuelve a hablar (o se calla)
      const callado = !globo.classList.contains('hidden');
      aplicarGlobo(callado);
      _guardarPrefsMascota({ callado });
      return;
    }
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

// ===== Barra inferior (solo movil) =====
// Las 5 secciones principales a un pulgar de distancia, como en NutriIA. En el telefono el
// sidebar esta escondido tras el boton de menu, asi que navegar costaba dos toques.
//
// NO se pinta para el admin: su navegacion es otra (panel, pagos, config) y no cabe en cinco
// iconos. Tampoco en login/registro, que no tienen .main.
function pintarBottomNav() {
  const u = Sesion.usuario;
  if (!Sesion.token || !u || u.rol === 'admin') return;
  if (!document.querySelector('.main')) return;
  if (document.querySelector('.bottomnav')) return;

  const ruta = location.pathname;
  const items = [
    { href: '/inicio.html', ic: '🏠', txt: 'Inicio' },
    { href: '/app.html', ic: '🔍', txt: 'Analizar' },
  ];
  // Las tres del planificador solo si su plan lo incluye: enlaces que llevan a un 403 son peor
  // que no tenerlos.
  if (u.incluye_planificador) {
    items.push({ href: '/plan.html', ic: '📅', txt: 'Plan' });
    if (u.despensa_activa) items.push({ href: '/despensa.html', ic: '🧺', txt: 'Despensa' });
    items.push({ href: '/platos.html', ic: '🍲', txt: 'Platos' });
  }

  const nav = document.createElement('nav');
  nav.className = 'bottomnav';
  nav.innerHTML = items
    .map((i) => `<a href="${i.href}" class="${ruta.endsWith(i.href) ? 'active' : ''}"><span class="bn-ic">${i.ic}</span>${i.txt}</a>`)
    .join('');
  document.body.appendChild(nav);
}
pintarBottomNav();

// ===== Perfil del usuario (modal) =====
//
// Se abre pulsando el nombre en el sidebar. Vive aqui y no en una pagina propia porque se
// alcanza desde CUALQUIER pantalla: sacarlo a /perfil.html obligaria a salir de lo que se
// estaba haciendo y volver.
//
// La foto se comprime EN EL NAVEGADOR a 256px antes de subirla, y se guarda como data URL en
// la fila del usuario. Sin compresion, una foto de celular son varios MB de base64 en la BD
// (que ademas se respalda entera en cada despliegue).
function comprimirFoto(file, maxLado = 256, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Archivo no valido'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function abrirPerfil() {
  const u = Sesion.usuario || {};
  let foto = u.foto || null;

  const back = document.createElement('div');
  back.className = 'modal-back show';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:460px;text-align:left">
    <h3>👤 Mi perfil</h3>
    <div class="modal-body">
      <div id="perfil-alerta" class="alert"></div>

      <div class="row" style="gap:14px;align-items:center;margin-bottom:16px">
        <div class="foto-preview" id="p-foto"></div>
        <div class="stack" style="gap:6px">
          <input type="file" id="p-file" accept="image/*" style="display:none" />
          <button class="btn btn-ghost btn-sm" type="button" id="p-elegir">📷 Elegir foto</button>
          <button class="btn btn-ghost btn-sm hidden" type="button" id="p-quitar">Quitar foto</button>
          <span class="muted" style="font-size:11.5px">Se guarda pequeña (256px)</span>
        </div>
      </div>

      <div class="field"><label>Nombre</label><input id="p-nombre" value="${esc(u.nombre || '')}" /></div>
      <div class="field"><label>Email</label><input id="p-email" type="email" value="${esc(u.email || '')}" /></div>
      <button class="btn btn-sm btn-block" type="button" id="p-guardar">Guardar cambios</button>

      <div style="border-top:1px solid var(--line);margin:18px 0 12px"></div>
      <h4 style="margin-bottom:8px">🔒 Cambiar contraseña</h4>
      <div class="field"><label>Contraseña actual</label><input id="p-pass-act" type="password" autocomplete="current-password" /></div>
      <div class="field"><label>Nueva contraseña</label><input id="p-pass-new" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres" /></div>
      <button class="btn btn-ghost btn-sm btn-block" type="button" id="p-cambiar-pass">Cambiar contraseña</button>
    </div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" type="button" data-cerrar>Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(back);

  const $ = (id) => back.querySelector('#' + id);
  const al = $('perfil-alerta');
  const cerrar = () => back.remove();
  back.querySelector('[data-cerrar]').onclick = cerrar;
  back.onclick = (e) => { if (e.target === back) cerrar(); };

  const iniciales = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  function pintarFoto() {
    $('p-foto').innerHTML = foto ? `<img src="${foto}" alt="" />` : iniciales(u.nombre);
    $('p-quitar').classList.toggle('hidden', !foto);
  }
  pintarFoto();

  $('p-elegir').onclick = () => $('p-file').click();
  $('p-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    limpiarAlerta(al);
    try { foto = await comprimirFoto(file); pintarFoto(); }
    catch { alerta(al, 'No pudimos procesar esa imagen.'); }
    e.target.value = '';
  };
  $('p-quitar').onclick = () => { foto = null; pintarFoto(); };

  $('p-guardar').onclick = async () => {
    limpiarAlerta(al);
    const body = { nombre: $('p-nombre').value, email: $('p-email').value, foto };
    if (!String(body.nombre).trim()) { alerta(al, 'Escribe tu nombre.'); return; }
    const btn = $('p-guardar');
    btn.disabled = true;
    try {
      const d = await api('/api/auth/perfil', { method: 'PATCH', body });
      Sesion.actualizarUsuario(d.usuario);
      alerta(al, 'Perfil actualizado.', 'ok');
      // El sidebar muestra nombre y foto: se repinta para que el cambio se vea al momento y no
      // al recargar. Se conserva la seccion activa.
      const sb = document.getElementById('sidebar');
      if (sb) {
        const act = sb.querySelector('.nav a.active');
        sb.innerHTML = pintarSidebar(act ? act.getAttribute('href').replace(/^\/|\.html$/g, '') : '');
        activarMenuMovil();
      }
    } catch (err) { alerta(al, err.error || 'No pudimos guardar tu perfil.'); }
    finally { btn.disabled = false; }
  };

  $('p-cambiar-pass').onclick = async () => {
    limpiarAlerta(al);
    const actual = $('p-pass-act').value;
    const nueva = $('p-pass-new').value;
    if (!actual || !nueva) { alerta(al, 'Escribe tu contraseña actual y la nueva.'); return; }
    const btn = $('p-cambiar-pass');
    btn.disabled = true;
    try {
      await api('/api/auth/password', { method: 'POST', body: { actual, nueva } });
      $('p-pass-act').value = '';
      $('p-pass-new').value = '';
      alerta(al, 'Contraseña actualizada.', 'ok');
    } catch (err) { alerta(al, err.error || 'No pudimos cambiar la contraseña.'); }
    finally { btn.disabled = false; }
  };
}

// El bloque del usuario en el sidebar abre el perfil. Se engancha por delegacion en el body
// para que siga funcionando cuando el sidebar se repinta tras guardar.
document.addEventListener('click', (e) => {
  if (e.target.closest('.userbox-btn')) abrirPerfil();
});

// ===== Modal de espera de la IA =====
//
// Generar un dia tarda ~3,5 s con Gemini y hasta ~30 s si el admin pone Claude de prioritario;
// verificar un plato puede irse a ~190 s (medido). El aviso vivia en la etiqueta del boton, que
// mide 11px y solo cabe "✨…": el usuario se quedaba medio minuto sin señales claras y creia
// que la app se habia colgado. Ya paso una vez.
//
// El modal NO se puede cerrar: ni con la cruz, ni pulsando el fondo, ni con Escape. La llamada
// ya esta en vuelo y cerrarlo no la cancelaria — solo dejaria al usuario creyendo que aborto
// algo que en realidad sigue corriendo y le va a cambiar el calendario debajo.
//
// Los mensajes ROTAN cada 3,5 s. No es adorno: en una espera larga, un texto quieto se lee como
// "esto se colgo", y el contador de segundos deja claro que el reloj sigue corriendo.
function modalCargando({ ic = '👨‍🍳', titulo = 'Cocinando…', texto = '', pasos = [] } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back show modal-cargando';
  back.innerHTML = `<div class="modal cargando-caja" role="status" aria-live="polite">
    <div class="cargando-ic">${ic}</div>
    <h3 class="cargando-titulo">${titulo}</h3>
    ${texto ? `<p class="cargando-texto">${texto}</p>` : ''}
    <div class="cargando-barra"><span></span></div>
    <p class="cargando-paso" data-paso>${pasos[0] || ''}</p>
    <p class="cargando-reloj" data-reloj></p>
  </div>`;
  document.body.appendChild(back);

  const elPaso = back.querySelector('[data-paso]');
  const elReloj = back.querySelector('[data-reloj]');
  const desde = Date.now();
  let i = 0;

  const rot = pasos.length > 1
    ? setInterval(() => { i = (i + 1) % pasos.length; elPaso.textContent = pasos[i]; }, 3500)
    : null;
  const reloj = setInterval(() => {
    const s = Math.round((Date.now() - desde) / 1000);
    elReloj.textContent = s >= 3 ? `${s} s` : '';
  }, 1000);

  return {
    // Fija un texto concreto y DETIENE la rotacion: cuando el que llama sabe en que paso va
    // de verdad ("generando martes, 3 de 7"), un mensaje generico rotando al lado seria ruido
    // y ademas lo pisaria al siguiente tick.
    paso(txt) {
      if (rot) clearInterval(rot);
      elPaso.textContent = txt;
    },
    cerrar() {
      if (rot) clearInterval(rot);
      clearInterval(reloj);
      back.remove();
    },
  };
}

// ===== Refresco del usuario en segundo plano =====
//
// exigirSesion() lee localStorage, que es una FOTO del momento del login. Eso basto mientras
// solo guardaba nombre y plan, pero ahora hay banderas que cambian lo que se PINTA
// (despensa_activa decide si "Mi despensa" aparece en los menus) y que pueden cambiar desde
// otro dispositivo o desde el panel admin.
//
// Sin esto: activas la despensa en el telefono y en la laptop sigue sin salir hasta cerrar y
// volver a entrar. Lo mismo con el plan cuando el admin aprueba un pago por Yape.
//
// Es una lectura ligera y va en segundo plano: la pagina ya se pinto con lo que habia, y solo
// se repinta la navegacion SI algo cambio (para no provocar un parpadeo en cada carga).
(function refrescarUsuario() {
  if (!Sesion.token || !Sesion.usuario) return;
  if (!document.querySelector('.main')) return; // login/registro
  // Foto de la sesion EN EL MOMENTO DE PEDIR. Si mientras la peticion viaja el usuario
  // cambia algo (activar la despensa, editar su perfil), la respuesta que vuelve ya es VIEJA:
  // aplicarla pisaria el cambio recien hecho y la pantalla volveria atras sola. Pasa en una
  // ventana estrecha —los primeros cientos de ms de la carga— pero es justo cuando alguien
  // que entra a 'Mi hogar' a activar la despensa pulsa el interruptor.
  const alPedir = localStorage.getItem(USER_KEY);
  api('/api/auth/yo')
    .then(({ usuario }) => {
      if (!usuario) return;
      if (localStorage.getItem(USER_KEY) !== alPedir) return; // cambio mientras tanto: manda lo local
      const antes = JSON.stringify(Sesion.usuario);
      if (JSON.stringify(usuario) === antes) return;
      Sesion.actualizarUsuario(usuario);
      const sb = document.getElementById('sidebar');
      if (sb && sb.innerHTML.trim()) {
        const act = sb.querySelector('.nav a.active');
        sb.innerHTML = pintarSidebar(act ? act.getAttribute('href').replace(/^\/|\.html$/g, '') : '');
        if (typeof activarMenuMovil === 'function') activarMenuMovil();
      }
      document.querySelector('.bottomnav')?.remove();
      if (typeof pintarBottomNav === 'function') pintarBottomNav();
    })
    .catch(() => { /* si falla, se queda con lo que ya tenia: no es critico */ });
})();
