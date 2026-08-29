import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: ['*://*.instagram.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'ig-downloader@tudominio.com', // puede ser cualquier string único tipo email
        data_collection_permissions: {
          required: ['none'], // no recolectas ni envías datos a servidores propios
        },
      },
    },
  },
});