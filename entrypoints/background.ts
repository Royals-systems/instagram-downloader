export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_IMAGES') {
      const urls: string[] = message.urls;
      urls.forEach((url, i) => {
        browser.downloads.download({
          url,
          filename: `instagram-post-${Date.now()}-${i + 1}.jpg`,
        });
      });
      sendResponse({ success: true });
    }
  });
});