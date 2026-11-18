import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.ionicmeetlite',
  appName: 'Meet Lite',
  webDir: 'www/browser',
  android: {
    allowMixedContent: true
  }
};

export default config;