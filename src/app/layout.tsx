import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mes Tickets Carrefour — Comparateur & Historique",
  description:
    "Centralisez vos tickets de caisse Carrefour et comparez instantanément les prix avant de remplir votre caddie Monoprix.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
