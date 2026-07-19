const CACHE='gym-v15';
const ASSETS=['./','./index.html','./styles.css','./core.js','./exercises.js','./sync.js','./coach.js','./app.js','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;
  // Only handle our OWN origin. Cross-origin requests (Google Identity script, Drive API) must go
  // straight to the network — intercepting them broke the OAuth sign-in and Drive calls (v10 bug).
  if(new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match('./index.html'))));});
