import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register Service Worker for PWA
if ("serviceWorker" in navigator) {
  // @ts-ignore
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      console.log("PWA not supported or failed to register.");
    });
}

// Disable pull-to-refresh on mobile WebViews
let startY = 0;
document.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length > 0) {
      startY = e.touches[0].clientY;
    }
  },
  { passive: false }
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 0) {
      const y = e.touches[0].clientY;
      const isPullingDown = y > startY;
      const isAtTop = window.scrollY <= 0;

      if (isPullingDown && isAtTop) {
        // Allow scrolling inside elements with auto/scroll overflow but NOT document body
        let target = e.target as Node | null;
        let canScroll = false;
        
        while (target && target !== document.body && target !== document) {
          if (target.nodeType === 1) { // Element node
            try {
              const element = target as HTMLElement;
              const style = window.getComputedStyle(element);
              if (
                (style.overflowY === "auto" || style.overflowY === "scroll") &&
                element.scrollTop > 0
              ) {
                canScroll = true;
                break;
              }
            } catch (err) {
              // Ignore computed style errors
            }
          }
          target = target.parentNode;
        }

        if (!canScroll) {
          if (e.cancelable) {
            e.preventDefault();
          }
        }
      }
    }
  },
  { passive: false }
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
