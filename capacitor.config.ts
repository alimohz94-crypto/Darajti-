import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.darajati.app',
  appName: 'دراجتي',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
