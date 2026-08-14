import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ezazahmad.wagestracker",
  appName: "WagesTracker",
  webDir: "dist",
  loggingBehavior: "none",
  ios: {
    path: "../ios",
    scheme: "App",
  },
};

export default config;
