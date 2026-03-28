import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import "./globals.css";

const titleFont = Space_Grotesk({
  variable: "--font-title",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "GitHub Skyline Radar",
  description:
    "A GitHub discovery MVP for AI projects, with a 3D skyline, day-night cycle, and update-driven building lights.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${titleFont.variable} ${monoFont.variable}`}>{children}</body>
    </html>
  );
}

