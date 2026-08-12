// RPG 自律驾驶舱 Service Worker — P1: Stale-While-Revalidate + 版本更新通知
const CACHE_NAME = 'rpg-cockpit-v4';
const CORE_ASSETS = ['./rpg.html', './manifest.json'];

// 安装：预缓存核心资源，跳过等待立即激活
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

// P1: 监听客户端消息（支持手动触发 skipWaiting）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 激活：清理旧缓存 + 通知客户端有新版本
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => {
      // P1: 通知所有客户端有新版本激活
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', cacheName: CACHE_NAME });
        });
      });
    }).then(() => self.clients.claim())
  );
});

// P1: Stale-While-Revalidate 策略
// - HTML 文档：网络优先（保证最新），失败回退缓存
// - 静态资源：缓存优先 + 后台更新（Stale-While-Revalidate）
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Google Fonts：直接网络请求（让浏览器 CDN 缓存处理）
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 同源 HTML 文档：网络优先策略（保证用户获取最新版本）
  if (url.origin === self.location.origin && event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          // 成功获取后缓存新版本
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => {
          // 网络失败：回退到缓存
          return caches.match(event.request).then((cached) => cached || caches.match('./rpg.html'));
        })
    );
    return;
  }

  // 同源静态资源：Stale-While-Revalidate（立即返回缓存，后台更新）
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        // 无论是否有缓存，都发起后台请求更新
        const fetchPromise = fetch(event.request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        }).catch(() => cached); // 网络失败时返回缓存（如果有）
        // 立即返回缓存，后台更新完成后下次生效
        return cached || fetchPromise;
      })
    );
    return;
  }
});
