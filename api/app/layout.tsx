import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magic Bracket Simulator API",
  description: "API and worker for the Magic Bracket Simulator; use the frontend app for the web UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-900 text-gray-100 antialiased">
        <main className="container mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
