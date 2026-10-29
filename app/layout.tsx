import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zero Margin Food Systems Foundation",
  description: "Exploring transparent, zero-margin food systems for shared nourishment.",
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
