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
