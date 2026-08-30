export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_BLOB') {
      // Usado para videos de Stories: el content script ya generó el blob
      // localmente (vía MediaRecorder), no hace falta ningún fetch acá.
      browser.downloads.download({
        url: message.dataUrl, // dataURL (base64), no una URL remota
        filename: message.filename,
      });
      sendResponse({ success: true });
      return;
    }

    if (message.type === 'DOWNLOAD_URL') {
      // El fetch real ocurre acá (contexto privilegiado de la extensión),
      // no en el content script, porque Firefox bloquea con CORS estricto
      // los fetch() cross-origin hechos desde un content script.
      //
      // Nota: NO se puede usar URL.createObjectURL ni FileReader acá.
      // En Chrome MV3 el background corre como service worker (sin DOM),
      // y ninguno de los dos existe en ese contexto. En Firefox sí existen
      // porque usa una background page normal — por eso funcionaba en un
      // lado y no en el otro. Solución: convertir el ArrayBuffer a base64
      // a mano (en chunks, para no reventar el stack con imágenes grandes)
      // y armar un dataURL, igual que ya se hace en DOWNLOAD_BLOB.
      (async () => {
        try {
          const res = await fetch(message.url, { credentials: 'omit' });
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const contentType = res.headers.get('content-type') || 'application/octet-stream';
          const buffer = await res.arrayBuffer();
          const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;

          await browser.downloads.download({
            url: dataUrl,
            filename: message.filename,
          });

          sendResponse({ success: true });
        } catch (err) {
          console.error('[IG Downloader background] Fallo al descargar', message.url, err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true; // mantiene el canal abierto para la respuesta async
    }
  });
});

// Convierte un ArrayBuffer a base64 sin usar FileReader ni Blob URLs,
// que no existen en el contexto de un service worker (MV3).
// Se procesa en chunks para evitar "Maximum call stack size exceeded"
// al aplicar String.fromCharCode sobre arreglos grandes (fotos/videos).
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32k, tamaño seguro para apply()
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}