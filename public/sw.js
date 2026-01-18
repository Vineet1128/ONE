// This is the service worker file.

self.addEventListener('push', function(event) {
  const body = event.data.text() || 'New notification';
  const options = {
    body: body,
    icon: '/assets/common/one_logo.png',
    badge: '/assets/common/logo.png'
  };

  event.waitUntil(
    self.registration.showNotification('ONE - XLRI', options)
  );
});