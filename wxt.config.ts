import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    version: '0.0.1', // súbelo de 0.0.0 a 0.0.1
    permissions: ['activeTab', 'downloads', 'scripting'],
    host_permissions: ['*://*.instagram.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'ig-downloader@tudominio.com',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  webExt: {
    binaries: {
      firefox: 'C:\\Program Files\\WindowsApps\\Mozilla.Firefox_154.0.1.0_x64__n80bbvh6b1yt2\\VFS\\ProgramFiles\\Mozilla Firefox\\firefox.exe',
    },
  },
});