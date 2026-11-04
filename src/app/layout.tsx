import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, Rajdhani } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Colmeia } from "./colmeia";
import { MenuUsuario } from "./menu-usuario";
import "./globals.css";

// Substitutas indicadas no brandbook, enquanto não há os arquivos licenciados das fontes pagas:
// Barlow no lugar de Kommon Grotesk, Barlow Condensed no de Heavitas e Rajdhani no de Eurostile.
const fonteTexto = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--fonte-texto",
});
const fonteTitulo = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--fonte-titulo",
});
const fonteRotulo = Rajdhani({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--fonte-rotulo",
});

export const metadata: Metadata = {
  title: "Plano Realize — Protótipo V2",
  description: "Protótipo da plataforma de gestão do Plano Realize. Somente dados fictícios.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${fonteTexto.variable} ${fonteTitulo.variable} ${fonteRotulo.variable}`}
    >
      <body>
        <Colmeia />
        <header className="cabecalho">
          <Link href="/pessoas" className="logo">
            <Image
              src="/logo-realize-branca.png"
              alt="Plano Realize"
              width={147}
              height={48}
              priority
            />
          </Link>
          <span className="selo-prototipo">Protótipo</span>
          <Suspense fallback={null}>
            <MenuUsuario />
          </Suspense>
        </header>
        {children}
      </body>
    </html>
  );
}
