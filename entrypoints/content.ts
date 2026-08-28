export default defineContentScript({
  matches: ['*://*.instagram.com/*'],
  main() {
    console.log('[IG Downloader] Content script activo');

    function findPostImage(): string | null {
      const main = document.querySelector('main');
      if (!main) return null;

      const imgs = Array.from(main.querySelectorAll('img')) as HTMLImageElement[];

      // filtramos imágenes chicas (avatares, iconos) — el post real es grande
      const candidates = imgs.filter(img => img.naturalWidth > 200);
      if (candidates.length === 0) return null;

      const img = candidates[0];

      // si tiene srcset, tomamos la de mayor calidad; si no, usamos src directo
      if (img?.srcset) {
        const urls = img?.srcset.split(',').map(s => s.trim().split(' ')[0]);
        return urls[urls.length - 1]?? null;
      }

      return img?.src ?? null;
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