import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

/** Dialogs and navigation drawers get first refusal on the Android back button. */
export function initializeNative() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add("native-app");
  if (Capacitor.getPlatform() === "android") {
    void App.addListener("backButton", ({ canGoBack }) => {
      const event = new Event("dana:native-back", { cancelable: true });
      if (!window.dispatchEvent(event)) return;
      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    });
  }
}
