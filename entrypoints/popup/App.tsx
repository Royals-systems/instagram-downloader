import { browser } from 'wxt/browser';
import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchImage() {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab||!tab.id) return;

        const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_POST_IMAGE' });

        if (response?.url) {
          setImageUrl(response.url);
        } else {
          setError('No se encontró ninguna imagen en esta página');
        }
      } catch (err) {
        setError('Abre un post de Instagram primero');
      }
    }

    fetchImage();
  }, []);

  function handleDownload() {
    if (!imageUrl) return;
    browser.downloads.download({
      url: imageUrl,
      filename: `instagram-post-${Date.now()}.jpg`,
    });
  }

  return (
    <div style={{ padding: 16, width: 280 }}>
      <h3>IG Downloader</h3>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {imageUrl && (
        <>
          <img src={imageUrl} alt="preview" style={{ width: '100%', borderRadius: 8 }} />
          <button onClick={handleDownload} style={{ marginTop: 8, width: '100%' }}>
            Descargar
          </button>
        </>
      )}
    </div>
  );
}

export default App;