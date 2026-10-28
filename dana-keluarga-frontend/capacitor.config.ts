import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "id.danakeluarga.app",
  appName: "Dana Keluarga",
  webDir: "dist",
  server: { androidScheme: "https", iosScheme: "capacitor" },
  // Use the device HTTP stack for API calls on Android/iOS.
  plugins: { CapacitorHttp: { enabled: true } },
  android: { allowMixedContent: false },
  ios: { contentInset: "never" },
};

export default config;
