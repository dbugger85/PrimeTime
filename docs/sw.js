// PrimeTime's background script, only for "🔔 notify me when it starts".
// It shows the notification the helper (worker/) sends, and opens PrimeTime when it's tapped.
// No offline copy: there's no fetch handler, so the page always loads from the internet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data?.json() ?? {}; } catch { /* a ping without a message */ }
  e.waitUntil(self.registration.showNotification(msg.title || 'Starting now', {
    body: msg.body || '',
    tag: msg.id || 'primetime', // the same event twice replaces the first
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    data: { id: msg.id },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) return tab.focus();
    return self.clients.openWindow('./');
  })());
});
