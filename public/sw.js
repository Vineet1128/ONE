// public/sw.js

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push notifications
self.addEventListener("push", (event) => {
  const body =
    event.data && event.data.text
      ? event.data.text()
      : "New notification";

  const options = {
    body,
    icon: "/assets/brand/one/one-mark-192.png",
    badge: "/assets/brand/one/one-mark-192.png"
  };

  event.waitUntil(
    self.registration.showNotification("ONE — XLRI", options)
  );
});