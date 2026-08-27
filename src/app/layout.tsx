import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DA GEOGUESSERS — Draft Slot Thunderdome",
  description:
    "A worldwide geography tournament for choosing fantasy football draft slots.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
