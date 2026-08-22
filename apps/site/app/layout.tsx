import type { Metadata } from 'next';
import { Newsreader, Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const display = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Norn — reconcile invoices without sending them anywhere',
  description:
    'Norn reads your invoices on your own machine and produces evidence an auditor can verify without taking your word for it.',
  openGraph: {
    title: 'Norn',
    description:
      'Local invoice reconciliation that produces evidence a third party can check.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
