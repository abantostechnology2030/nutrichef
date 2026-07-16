// Service Worker de NutriChefIA: muestra notificaciones de recordatorios
// y permite que la app sea instalable (PWA).
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Handler de fetch (pass-through): necesario para que Chrome considere la app
// instalable. No cachea; deja que el navegador maneje cada peticion.
self.addEventListener('fetch', (event) => { /* network passthrough */ });

// Al hacer clic en una notificación, enfoca/abre el plan de comidas.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const c of clientes) {
        if (c.url.includes('/plan.html') && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/plan.html');
    })
  );
});
