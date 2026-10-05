// Startbildschirm: Während die Animation läuft, wird die App schon angefragt. Das weckt den Server auf,
// damit der eigentliche Wechsel danach schnell geht. Die Animation ist mindestens kurz zu sehen.
(() => {
  const MIN_SHOW = 1500;
  const MAX_WAIT = 10000;
  const started = Date.now();
  const warmUp = fetch('/healthz', { cache: 'no-store' })
    .then(() => fetch('/', { credentials: 'same-origin', redirect: 'manual', cache: 'no-store' }))
    .catch(() => {});
  const timeout = new Promise((resolve) => { setTimeout(resolve, MAX_WAIT); });
  Promise.race([warmUp, timeout]).then(() => {
    setTimeout(() => location.replace('/'), Math.max(0, MIN_SHOW - (Date.now() - started)));
  });
})();
