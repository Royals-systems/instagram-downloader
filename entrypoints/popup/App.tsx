import { browser } from 'wxt/browser';
import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchImages() {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) return;

        const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_POST_IMAGE' });

        if (response?.urls?.length > 0) {
          setImageUrls(response.urls);
        } else {
          setError('No se encontró ninguna imagen en esta página');
        }
      } catch (err) {
        setError('Abre un post de Instagram primero');
      }
    }

    fetchImages();
  }, []);

  function handleDownload(url: string, index: number) {
    browser.downloads.download({
      url,
      filename: `instagram-post-${Date.now()}-${index}.jpg`,
    });
  }

  return (
    <div style={{ padding: 16, width: 280 }}>
      <h3>IG Downloader</h3>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {imageUrls.map((url, i) => (
        <div key={url} style={{ marginBottom: 12 }}>
          <img src={url} alt={`preview-${i}`} style={{ width: '100%', borderRadius: 8 }} />
          <button onClick={() => handleDownload(url, i)} style={{ marginTop: 4, width: '100%' }}>
            Descargar imagen {i + 1}
          </button>
        </div>
      ))}
    </div>
  );
}

export default App;