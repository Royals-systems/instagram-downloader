export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  main() {
    console.log('[IG Downloader] Content script activo');

    // ... (todas las funciones que ya tienes: getShortcodeFromUrl, getCsrfToken,
    // fetchPostData, bestCandidateUrl, extractImageUrls, getPostImages se quedan igual)
    function getShortcodeFromUrl(): string | null {
      const match = window.location.pathname.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
      return match ? (match[2] ?? null) : null;
    }

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
      // ordenamos por ancho descendente y tomamos la más grande
      const sorted = [...candidates].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
      return sorted[0]?.url ?? null;
    }

    function extractImageUrls(json: any): string[] {
      const item = json?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
      if (!item) return [];

      // Post de una sola imagen (no carrusel)
      if (!item.carousel_media) {
        const url = bestCandidateUrl(item.image_versions2?.candidates);
        return url ? [url] : [];
      }

      // Carrusel: una URL por cada slide
      return item.carousel_media
        .map((slide: any) => bestCandidateUrl(slide.image_versions2?.candidates))
        .filter((url: string | null): url is string => !!url);
    }

    async function getPostImages(): Promise<string[]> {
      const shortcode = getShortcodeFromUrl();
      if (!shortcode) return [];

      const json = await fetchPostData(shortcode);
      return extractImageUrls(json);
    }

    async function downloadAllImages() {
      const urls = await getPostImages();
      await browser.runtime.sendMessage({ type: 'DOWNLOAD_IMAGES', urls });
    }

    function createDownloadButton(): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.textContent = 'Download';
      btn.id = 'ig-downloader-btn';
      btn.style.cssText = `
        background: #0095f6;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 5px 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        margin-left: 8px;
      `;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.textContent = '...';
        btn.disabled = true;
        try {
          await downloadAllImages();
          btn.textContent = 'Listo ✓';
        } catch (err) {
          console.error('[IG Downloader] Error al descargar:', err);
          btn.textContent = 'Error';
        }
        setTimeout(() => {
          btn.textContent = 'Download';
          btn.disabled = false;
        }, 2000);
      });
      return btn;
    }

    function findFollowButton(): HTMLElement | null {
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      return buttons.find(el =>
        el.textContent?.trim() === 'Following' || el.textContent?.trim() === 'Follow'
      ) as HTMLElement | null;
    }

    function injectButton() {
      if (document.getElementById('ig-downloader-btn')) return; // ya existe, no duplicar

      const followBtn = findFollowButton();
      if (!followBtn) return;

      const downloadBtn = createDownloadButton();
      followBtn.insertAdjacentElement('afterend', downloadBtn);
    }

    // Reintenta inyectar cada vez que cambia el DOM (Instagram es SPA, navega sin recargar)
    const observer = new MutationObserver(() => {
      injectButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Intento inicial
    injectButton();

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_POST_IMAGE') {
        getPostImages()
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