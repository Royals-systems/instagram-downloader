export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_BLOB') {
      browser.downloads.download({
        url: message.dataUrl, // dataURL (base64), no una URL remota
        filename: message.filename,
      });
      sendResponse({ success: true });
    }
  });
});