"use client";

import { useEffect, useMemo, useRef } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import type { Reveal } from "@/lib/types";
import styles from "./RevealMap.module.css";

const TRUTH_ICON = { scale: 12, fillColor: "#f5ff38", fillOpacity: 1, strokeColor: "#18032d", strokeWeight: 3 };
const GUESS_ICON = { scale: 10, fillColor: "#e62b9c", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 };

function byDistance(left: Reveal["guesses"][number], right: Reveal["guesses"][number]) {
  return left.distanceKm - right.distanceKm;
}

export default function RevealMap({ heading, reveal }: { heading: string; reveal: Reveal }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const guesses = useMemo(() => [...reveal.guesses].sort(byDistance), [reveal]);

  useEffect(() => {
    let cancelled = false;
    void loadGoogleMaps().then((maps) => {
      if (cancelled || !containerRef.current) return;
      const map = new maps.Map(containerRef.current, {
        center: reveal.actual,
        zoom: 3,
        minZoom: 1,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        gestureHandling: "cooperative",
      });
      const bounds = new maps.LatLngBounds();
      bounds.extend(reveal.actual);
      new maps.Marker({
        map,
        position: reveal.actual,
        zIndex: 10,
        title: `${reveal.actual.label}, ${reveal.actual.country}`,
        icon: { path: maps.SymbolPath.CIRCLE, ...TRUTH_ICON },
        label: { text: "★", color: "#18032d", fontSize: "15px", fontWeight: "900" },
      });
      guesses.forEach((guess, index) => {
        const position = { lat: guess.lat, lng: guess.lng };
        bounds.extend(position);
        new maps.Marker({
          map,
          position,
          title: `${guess.playerName}, ${guess.distanceKm.toFixed(1)} km off`,
          icon: { path: maps.SymbolPath.CIRCLE, ...GUESS_ICON },
          label: { text: String(index + 1), color: "#fff", fontSize: "11px", fontWeight: "900" },
        });
        new maps.Polyline({
          map,
          path: [position, reveal.actual],
          strokeColor: "#e62b9c",
          strokeOpacity: 0.65,
          strokeWeight: 2,
        });
      });
      // A lone pin makes fitBounds slam to max zoom, which reads as a bug rather than a reveal.
      maps.event.addListenerOnce(map, "bounds_changed", () => {
        if ((map.getZoom() ?? 0) > 8) map.setZoom(8);
      });
      map.fitBounds(bounds, 48);
    });
    return () => { cancelled = true; };
  }, [reveal, guesses]);

  return (
    <div className={styles.reveal}>
      <strong className={styles.heading}>{heading}</strong>
      <div ref={containerRef} className={styles.canvas} />
      <ol className={styles.legend}>
        <li className={styles.truth}>★ {reveal.actual.label}, {reveal.actual.country}</li>
        {guesses.map((guess, index) => (
          <li key={guess.playerId}>
            <b>{index + 1}</b> {guess.playerName} {guess.distanceKm.toFixed(1)} KM
          </li>
        ))}
      </ol>
    </div>
  );
}
