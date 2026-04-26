// VAMIT-5 Athletes — Service Worker (Web Push)
// =====================================================================

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Receive push event
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'VAMIT-5', body: event.data.text() };
  }

  const title = data.title || 'VAMIT-5 Athletes';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/badge-72.png',
    image: data.image,
    tag: data.tag || 'vamit5',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    data: { url: data.url || '/dashboard.html', ...data.data },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click on notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a tab is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('/dashboard.html') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Subscription change (browser rotates the endpoint)
self.addEventListener('pushsubscriptionchange', (event) => {
  // App will re-subscribe on next dashboard open
  console.log('Push subscription changed, will re-subscribe');
});
