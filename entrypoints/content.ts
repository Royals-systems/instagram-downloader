export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  main() {
    console.log('[IG Downloader] Content script activo');

    function findPostImage(): string | null {
      // Instagram pone las imágenes de post dentro de <article>
      const article = document.querySelector('article');
      if (!article) return null;

      const img = article.querySelector('img[srcset]') as HTMLImageElement | null;
      if (!img) return null;

      // srcset trae varias resoluciones, tomamos la de mayor calidad (la última)
      const srcset = img.srcset;
      const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
      return urls[urls.length - 1] || img.src;
    }

    // Escuchamos cuando el popup nos pida la imagen
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_POST_IMAGE') {
        const url = findPostImage();
        sendResponse({ url });
      }
      return true; // importante para respuesta async
    });
  },
});