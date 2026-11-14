// Service worker mínimo: permite instalar como app. Tudo vem do servidor local, sem cache,
// para os dados estarem sempre atualizados.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* deixa o navegador buscar normalmente */ });
