export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  main() {
    console.log('[IG Downloader] Content script activo');

    // ---------- Utilidades compartidas ----------


    function ensureFeedButtons() {
      const articles = document.querySelectorAll('article');
      articles.forEach(article => {
        if ((article as HTMLElement).dataset.igDownloaderDone === '1') return;
        injectFeedButton(article as HTMLElement);
      });
    }
    function getCsrfToken(): string {
      const match = document.cookie.match(/csrftoken=([^;]+)/);
      return match ? (match[1] ?? '') : '';
    }

    function sleep(ms: number) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function fetchPostData(shortcode: string) {
      const url = 'https://www.instagram.com/graphql/query';
      const body = new URLSearchParams({
        variables: JSON.stringify({
          shortcode,
          __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
        }),
        doc_id: '27128499623469141',
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-ig-app-id': '936619743392459',
          'x-csrftoken': getCsrfToken(),
        },
        body: body.toString(),
        credentials: 'include',
      });

      if (!res.ok) throw new Error(`GraphQL request failed: ${res.status}`);
      return res.json();
    }

    function bestCandidateUrl(candidates: any[]): string | null {
      if (!candidates || candidates.length === 0) return null;
      const sorted = [...candidates].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      return sorted[0]?.url ?? null;
    }

    function bestVideoUrl(versions: any[]): string | null {
      if (!versions || versions.length === 0) return null;
      const sorted = [...versions].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      return sorted[0]?.url ?? null;
    }

    function extractMediaUrls(json: any): string[] {
      const item = json?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
      if (!item) return [];

      if (item.media_type === 2 && item.video_versions?.length > 0) {
        const url = bestVideoUrl(item.video_versions);
        return url ? [url] : [];
      }

      if (!item.carousel_media) {
        const url = bestCandidateUrl(item.image_versions2?.candidates);
        return url ? [url] : [];
      }

      return item.carousel_media
        .map((slide: any) => {
          if (slide.media_type === 2 && slide.video_versions?.length > 0) {
            return bestVideoUrl(slide.video_versions);
          }
          return bestCandidateUrl(slide.image_versions2?.candidates);
        })
        .filter((url: string | null): url is string => !!url);
    }

    async function getMediaUrlsForShortcode(shortcode: string): Promise<string[]> {
      const json = await fetchPostData(shortcode);
      return extractMediaUrls(json);
    }

    async function downloadSingleUrl(url: string, index: number) {
      // Firefox aplica CORS estricto a fetch() hecho desde un content script
      // hacia otro dominio (el CDN de Instagram, fbcdn.net) — en Chrome esto
      // pasaba sin problema, en Firefox lo bloquea con "NetworkError". Por eso
      // el fetch real ocurre en el background, que sí tiene acceso privilegiado.
      try {
        const isVideo = url.includes('.mp4');
        const ext = isVideo ? 'mp4' : 'jpg';
        await browser.runtime.sendMessage({
          type: 'DOWNLOAD_URL',
          url,
          filename: `instagram-post-${Date.now()}-${index + 1}.${ext}`,
        });
      } catch (err) {
        console.error('[IG Downloader] Fallo al descargar', url, err);
      }
    }

    async function downloadUrls(urls: string[]) {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        if (!url) continue;
        await downloadSingleUrl(url, i);
      }
    }

function createDownloadButton(onClick: () => Promise<void>, extraClass: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = 'Download';
  btn.className = `ig-downloader-btn ${extraClass}`;
  btn.style.cssText = `
    background: #0095f6;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    margin-left: 8px;
    position: static;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  `;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const original = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    try {
      await onClick();
      btn.textContent = 'Listo ✓';
    } catch (err) {
      console.error('[IG Downloader] Error al descargar:', err);
      btn.textContent = 'Error';
    }
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2000);
  });
  return btn;
}

function findMoreOptionsButton(scope: ParentNode = document): HTMLElement | null {
  const svg = scope.querySelector(
    'svg[aria-label="More options"], svg[aria-label="Más opciones"], ' +
    'svg[aria-label="More"], svg[aria-label="Más"], ' +
    'svg[aria-label="Menu"], svg[aria-label="Menú"]'
  );
  if (!svg) return null;
  return svg.closest('div[role="button"], button') as HTMLElement | null;
}

    // ---------- Modo 1: página de post individual (/p/... o /reel/...) ----------

    function isPostPage(): boolean {
      return /\/(p|reel|reels)\/[A-Za-z0-9_-]+/.test(window.location.pathname);
    }

    function getShortcodeFromUrl(): string | null {
      const match = window.location.pathname.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      return match ? (match[2] ?? null) : null;
    }

// Reels usa virtualización de React: los nodos se reciclan al scrollear y
// cualquier botón insertado DENTRO del árbol de React se pierde al re-renderizar.
// Por eso este botón vive fuera de ese árbol, como hijo directo de <body>,
// posicionado con position:fixed. React nunca lo toca.
let floatingBtn: HTMLButtonElement | null = null;

function ensureFloatingButton() {
  if (!isPostPage()) {
    floatingBtn?.remove();
    floatingBtn = null;
    return;
  }

  const currentShortcode = getShortcodeFromUrl();

  if (floatingBtn && floatingBtn.dataset.shortcode === currentShortcode) return; // mismo post, nada que hacer

  floatingBtn?.remove(); // si había uno de otro post/reel, lo quitamos

  const btn = createDownloadButton(async () => {
    const shortcode = getShortcodeFromUrl();
    if (!shortcode) throw new Error('No shortcode');
    const urls = await getMediaUrlsForShortcode(shortcode);
    await downloadUrls(urls);
  }, 'ig-downloader-btn-post');

  btn.dataset.shortcode = currentShortcode ?? '';
  btn.style.position = 'fixed';
  btn.style.top = '16px';
  btn.style.right = '16px';
  btn.style.zIndex = '999999';

  document.body.appendChild(btn);
  floatingBtn = btn;
}

    // ---------- Modo 2: feed principal (scroll infinito) ----------

    function getShortcodeFromArticle(article: Element): string | null {
      const link = article.querySelector('a[href*="/p/"], a[href*="/reel/"]') as HTMLAnchorElement | null;
      const href = link?.getAttribute('href');
      if (!href) return null;
      const match = href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      return match ? (match[2] ?? null) : null;
    }

function injectFeedButton(article: HTMLElement) {
  if (isPostPage()) return; // en post/reel individual, ensureFloatingButton se encarga
  if (article.dataset.igDownloaderDone === '1') return;
  article.dataset.igDownloaderDone = '1';

  const shortcode = getShortcodeFromArticle(article);
  if (!shortcode) return;

  const moreBtn = findMoreOptionsButton(article);
  if (!moreBtn || !moreBtn.parentElement) return;

  const btn = createDownloadButton(async () => {
    const urls = await getMediaUrlsForShortcode(shortcode);
    await downloadUrls(urls);
  }, 'ig-downloader-btn-feed');
  moreBtn.parentElement.insertBefore(btn, moreBtn);
}
    const feedIntersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            injectFeedButton(entry.target as HTMLElement);
            feedIntersectionObserver.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '300px' }
    );

    function watchNewArticles(nodes: NodeList | HTMLElement[]) {
      nodes.forEach(node => {
        if (!(node instanceof HTMLElement)) return;
        const articles = node.matches?.('article') ? [node] : Array.from(node.querySelectorAll?.('article') ?? []);
        articles.forEach(article => {
          if ((article as HTMLElement).dataset.igDownloaderWatched === '1') return;
          (article as HTMLElement).dataset.igDownloaderWatched = '1';
          feedIntersectionObserver.observe(article);
        });
      });
    }

    const feedMutationObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          watchNewArticles(mutation.addedNodes as unknown as HTMLElement[]);
        }
      });
    });
    
    let observedMain: HTMLElement | null = null;

    function startFeedWatcher() {
      const main = document.querySelector('main');
      if (!main || main === observedMain) return; // ya estamos observando este mismo <main>

      observedMain = main as HTMLElement;
      watchNewArticles(main.querySelectorAll('article'));
      feedMutationObserver.observe(main, { childList: true, subtree: true });
    }

    // ---------- Modo 3: stories ----------

    function isStoryPage(): boolean {
      return window.location.pathname.startsWith('/stories/');
    }

    function getStoryUsernameFromUrl(): string | null {
      const match = window.location.pathname.match(/\/stories\/([^/]+)/);
      return match ? (match[1] ?? null) : null;
    }

    function isLargeVisible(el: HTMLElement): boolean {
      const rect = el.getBoundingClientRect();
      // la story activa ocupa una porción grande y real de la pantalla;
      // las miniaturas laterales (previews de otras cuentas) son mucho más chicas
      return rect.width > 250 && rect.height > 250 && el.offsetParent !== null;
    }

    function getActiveStoryVideo(): HTMLVideoElement | null {
      const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      return videos.find(v => (v.currentSrc || v.src) && isLargeVisible(v)) ?? null;
    }

    function getActiveStoryImage(): HTMLImageElement | null {
      const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
      const candidates = imgs.filter(img => img.naturalWidth > 400 && isLargeVisible(img));
      candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });
      return candidates[0] ?? null;
    }

    // El src del <video> en Stories es un blob: de MediaSource (streaming adaptativo),
    // no un archivo real — fetch() sobre eso siempre falla con "Failed to fetch".
    // La única forma confiable de obtenerlo es grabar lo que el <video> reproduce,
    // usando las APIs nativas captureStream + MediaRecorder.
    async function captureActiveVideoBlob(video: HTMLVideoElement): Promise<Blob> {
      // captureStream() graba desde el instante en que empieza la grabación, no
      // desde el inicio del video. Si el usuario le da al botón a mitad de la
      // story, solo se captura el resto — y el archivo resultante sale con
      // metadata rota (duración 0:00, sin seek). Por eso rebobinamos a 0 primero.
      video.pause();
      video.currentTime = 0;

      await new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true });
        setTimeout(resolve, 800); // límite de seguridad si el seek no dispara
      });

      // MediaRecorder solo captura frames mientras el video reproduce activamente;
      // si está pausado (Instagram lo pausa a veces cuando DevTools roba el foco),
      // el resultado sale vacío (solo el header del archivo, ~110 bytes).
      // Por eso forzamos play() y esperamos a que realmente esté reproduciendo.
      try {
        await video.play();
      } catch {
        // el navegador puede bloquear autoplay con audio; seguimos igual,
        // el video puede seguir corriendo silenciado
      }

      if (video.paused) {
        await new Promise<void>((resolve) => {
          video.addEventListener('playing', () => resolve(), { once: true });
          setTimeout(resolve, 1500); // límite de seguridad si nunca dispara 'playing'
        });
      }

      return new Promise((resolve, reject) => {
        const anyVideo = video as any;
        const stream: MediaStream | null = anyVideo.captureStream
          ? anyVideo.captureStream()
          : anyVideo.mozCaptureStream
            ? anyVideo.mozCaptureStream()
            : null;
        if (!stream) {
          reject(new Error('captureStream no soportado'));
          return;
        }

        const chunks: BlobPart[] = [];
        const recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm',
          videoBitsPerSecond: 2_000_000, // limitamos el bitrate para bajar la carga de CPU al codificar
        });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        recorder.onerror = (e) => reject(e);

        recorder.start(1000); // vuelca datos cada 1s (menos overhead que cada 250ms)

        // Si el video ya terminó o dura muy poco, cortamos con un límite de seguridad;
        // si no, grabamos hasta que termine (evento 'ended') para capturarlo completo.
        const maxMs = 20000;
        const safetyTimer = setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, maxMs);

        video.addEventListener('ended', () => {
          clearTimeout(safetyTimer);
          if (recorder.state !== 'inactive') recorder.stop();
        }, { once: true });
      });
    }

    function clickNextStory(): boolean {
      const nextBtn = document.querySelector('button[aria-label="Next"], svg[aria-label="Next"]');
      const clickable = nextBtn?.closest('button, div[role="button"]') as HTMLElement | null ?? nextBtn as HTMLElement | null;
      if (!clickable) return false;
      clickable.click();
      return true;
    }

    async function downloadBlobDirect(blob: Blob, index: number, ext: string) {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await browser.runtime.sendMessage({
        type: 'DOWNLOAD_BLOB',
        dataUrl,
        filename: `instagram-post-${Date.now()}-${index + 1}.${ext}`,
      });
    }

    async function waitForNewVideoSrc(lastSrc: string | null, timeoutMs = 1200): Promise<HTMLVideoElement | null> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const video = getActiveStoryVideo();
        if (video) {
          const src = video.currentSrc || video.src;
          if (src && src !== lastSrc) return video;
        } else {
          return null; // ya no hay video (es imagen), no seguimos esperando
        }
        await sleep(100);
      }
      return getActiveStoryVideo(); // se acabó el tiempo, usamos lo que haya (mejor que nada)
    }

    // Mientras esté grabando un video de story, pausamos todo el trabajo de
    // fondo (setInterval, MutationObserver) para no saturar el hilo principal —
    // eso causaba que Instagram tartamudeara y su reproductor "retrocediera"
    // para recuperar el buffer, y grabábamos ese tartamudeo también.
    let isCapturingStory = false;

    async function scanAllStories(): Promise<void> {
      isCapturingStory = true; // pausa el trabajo de fondo (setInterval, observers) mientras grabamos
      try {
        const startUsername = getStoryUsernameFromUrl();
        const seenImageUrls = new Set<string>();
        let lastVideoSrc: string | null = null;
        let downloadIndex = 0;

        for (let i = 0; i < 20; i++) {
          await sleep(300);

          // Instagram reutiliza el mismo <video> entre slides consecutivos de video
          // y actualiza su src de forma asíncrona — esperamos a que realmente cambie
          // antes de grabar, si no capturamos un stream vacío (0 bytes).
          const video = await waitForNewVideoSrc(lastVideoSrc);
          if (video) {
            lastVideoSrc = video.currentSrc || video.src;
            try {
              const blob = await captureActiveVideoBlob(video); // espera a que termine el video
              await downloadBlobDirect(blob, downloadIndex, 'webm');
              downloadIndex++;
            } catch (err) {
              console.error('[IG Downloader] Fallo al capturar video de story', err);
            }
          } else {
            const img = getActiveStoryImage();
            const url = img?.src ?? null;
            if (url && !seenImageUrls.has(url)) {
              seenImageUrls.add(url);
              await downloadSingleUrl(url, downloadIndex);
              downloadIndex++;
            }
          }

          const clicked = clickNextStory();
          if (!clicked) break;

          await sleep(400);
          if (getStoryUsernameFromUrl() !== startUsername) break;
        }
      } finally {
        isCapturingStory = false; // reanuda el trabajo de fondo pase lo que pase
      }
    }

// Mismo patrón que ensureFloatingButton: vive fuera del árbol de React,
// así no depende de encontrar el ícono "..." (que cambia de aria-label según
// la vista) ni se pierde si Instagram recicla nodos al pasar de story en story.
let floatingStoryBtn: HTMLButtonElement | null = null;

function ensureFloatingStoryButton() {
  if (!isStoryPage()) {
    floatingStoryBtn?.remove();
    floatingStoryBtn = null;
    return;
  }

  const currentUsername = getStoryUsernameFromUrl();

  if (floatingStoryBtn && floatingStoryBtn.dataset.username === currentUsername) return;

  floatingStoryBtn?.remove();

  const btn = createDownloadButton(async () => {
    await scanAllStories();
  }, 'ig-downloader-btn-story');

  btn.dataset.username = currentUsername ?? '';
  btn.style.position = 'fixed';
  btn.style.top = '16px';
  btn.style.right = '16px';
  btn.style.zIndex = '999999';

  document.body.appendChild(btn);
  floatingStoryBtn = btn;
}

    // ---------- Arranque ----------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedCheck() {
  if (isCapturingStory) return; // no interferir mientras se graba un video
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (isCapturingStory) return;
    ensureFloatingButton();
    ensureFloatingStoryButton();
  }, 300);
}

const pageObserver = new MutationObserver(() => debouncedCheck());
pageObserver.observe(document.body, { childList: true, subtree: false });


setInterval(() => {
  if (isCapturingStory) return; // pausado mientras se graba un video de story
  ensureFloatingButton();
  ensureFloatingStoryButton();
  startFeedWatcher();
  ensureFeedButtons(); // red de seguridad para artículos que el IntersectionObserver no detectó
}, 800);

    ensureFloatingButton();
    ensureFloatingStoryButton();
    startFeedWatcher();

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_POST_IMAGE') {
        const shortcode = getShortcodeFromUrl();
        if (!shortcode) {
          sendResponse({ urls: [] });
          return;
        }
        getMediaUrlsForShortcode(shortcode)
          .then(urls => sendResponse({ urls }))
          .catch(err => {
            console.error('[IG Downloader] Error:', err);
            sendResponse({ urls: [], error: err.message });
          });
        return true;
      }
    });
  },
});