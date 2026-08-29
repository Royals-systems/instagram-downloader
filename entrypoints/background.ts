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
      (async () => {
        try {
          const res = await fetch(message.url, { credentials: 'omit' });
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);

          await browser.downloads.download({
            url: blobUrl,
            filename: message.filename,
          });

          // liberamos el blob URL después de un rato, una vez ya se disparó la descarga
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

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