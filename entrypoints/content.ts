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
      // El CDN de Instagram rechaza descargas directas sin el origen correcto,
      // y las URLs blob: de video en Stories se invalidan apenas Instagram
      // avanza a la siguiente story — por eso esto se llama de inmediato al
      // capturar cada media, nunca en batch al final.
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const blob = await res.blob();
        const isVideo = blob.type.includes('video') || url.includes('.mp4');
        const ext = isVideo ? 'mp4' : 'jpg';

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

    function getCurrentStoryMediaUrl(): string | null {
      const video = document.querySelector('video') as HTMLVideoElement | null;
      if (video?.src) return video.src;

      const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
      const storyImg = imgs.find(img => img.naturalWidth > 400);
      return storyImg?.src ?? null;
    }

    function clickNextStory(): boolean {
      const nextBtn = document.querySelector('button[aria-label="Next"], svg[aria-label="Next"]');
      const clickable = nextBtn?.closest('button, div[role="button"]') as HTMLElement | null ?? nextBtn as HTMLElement | null;
      if (!clickable) return false;
      clickable.click();
      return true;
    }

    async function scanAllStories(): Promise<void> {
      const startUsername = getStoryUsernameFromUrl();
      const seen = new Set<string>();
      let downloadIndex = 0;

      for (let i = 0; i < 20; i++) {
        await sleep(300);
        const url = getCurrentStoryMediaUrl();
        if (url && !seen.has(url)) {
          seen.add(url);
          await downloadSingleUrl(url, downloadIndex); // descarga ya, antes de que se invalide el blob
          downloadIndex++;
        }

        const clicked = clickNextStory();
        if (!clicked) break;

        await sleep(400);
        if (getStoryUsernameFromUrl() !== startUsername) break;
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
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    ensureFloatingButton();
    ensureFloatingStoryButton();
  }, 300);
}

const pageObserver = new MutationObserver(() => debouncedCheck());
pageObserver.observe(document.body, { childList: true, subtree: false });


setInterval(() => {
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