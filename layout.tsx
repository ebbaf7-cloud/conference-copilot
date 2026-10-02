import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conference Copilot",
  description: "Turn a conference attendee list into a focused, relevant meeting shortlist.",
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
