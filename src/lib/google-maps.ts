"use client";

let mapsPromise: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("Maps only loads in a browser."));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;

  mapsPromise = new Promise((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) {
      reject(new Error("Google Maps is not configured."));
      return;
    }

    const callback = `draftMapsReady_${Date.now()}`;
    const globalWindow = window as typeof window & Record<string, unknown>;
    globalWindow[callback] = () => {
      delete globalWindow[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      delete globalWindow[callback];
      mapsPromise = null;
      reject(new Error("Google Maps failed to load. Check your connection and retry."));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}
