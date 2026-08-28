export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  main() {
    console.log('[IG Downloader] Content script activo');

    // ---------- Utilidades compartidas ----------

    function getCsrfToken(): string {
      const match = document.cookie.match(/csrftoken=([^;]+)/);
      return match ? (match[1] ?? '') : '';
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

    async function downloadUrls(urls: string[]) {
      await browser.runtime.sendMessage({ type: 'DOWNLOAD_IMAGES', urls });
    }

    function createDownloadButton(onClick: () => Promise<void>): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.textContent = 'Download';
      btn.className = 'ig-downloader-btn';
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
    'svg[aria-label="More options"], svg[aria-label="Más opciones"], svg[aria-label="More"], svg[aria-label="Más"]'
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

    function injectSinglePostButton() {
      if (!isPostPage()) {
        document.querySelector('.ig-downloader-btn')?.remove();
        return;
      }
      if (document.querySelector('.ig-downloader-btn')) return;

      const moreBtn = findMoreOptionsButton();
      if (!moreBtn || !moreBtn.parentElement) return;

      const btn = createDownloadButton(async () => {
        const shortcode = getShortcodeFromUrl();
        if (!shortcode) throw new Error('No shortcode');
        const urls = await getMediaUrlsForShortcode(shortcode);
        await downloadUrls(urls);
      });
      moreBtn.parentElement.insertBefore(btn, moreBtn);
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
      if (article.dataset.igDownloaderDone === '1') return;
      article.dataset.igDownloaderDone = '1';

      const shortcode = getShortcodeFromArticle(article);
      if (!shortcode) return;

      const moreBtn = findMoreOptionsButton(article);
      if (!moreBtn || !moreBtn.parentElement) return;

      const btn = createDownloadButton(async () => {
        const urls = await getMediaUrlsForShortcode(shortcode);
        await downloadUrls(urls);
      });
      moreBtn.parentElement.insertBefore(btn, moreBtn);
    }

    // Solo inyecta cuando el post está por entrar en pantalla (barato, nativo del navegador)
    const feedIntersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            injectFeedButton(entry.target as HTMLElement);
            feedIntersectionObserver.unobserve(entry.target); // one-shot, ya no hace falta seguir vigilando
          }
        });
      },
      { rootMargin: '300px' } // empieza a preparar un poco antes de que sea visible
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

    // Observer acotado: solo mira childList (no subtree profundo) sobre main,
    // y solo procesa los nodos añadidos directamente, no vuelve a escanear todo.
    const feedMutationObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          watchNewArticles(mutation.addedNodes as unknown as HTMLElement[]);
        }
      });
    });

    function startFeedWatcher() {
      const main = document.querySelector('main');
      if (!main) return;
      watchNewArticles(main.querySelectorAll('article')); // artículos ya presentes al cargar
      feedMutationObserver.observe(main, { childList: true, subtree: true });
    }

    // ---------- Arranque ----------

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function debouncedCheck() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        injectSinglePostButton();
      }, 300);
    }

    const pageObserver = new MutationObserver(() => debouncedCheck());
    pageObserver.observe(document.body, { childList: true, subtree: false });

    injectSinglePostButton();
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