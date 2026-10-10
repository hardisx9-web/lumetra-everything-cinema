import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumetra — Everything Cinema",
  description: "Enter a living universe of films, filmmakers, images and histories.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
