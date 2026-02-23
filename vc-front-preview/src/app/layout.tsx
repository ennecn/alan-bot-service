import type { Metadata, Viewport } from 'next';
import { Playfair_Display, DM_Sans } from 'next/font/google';
import './globals.css';
import BottomNav from '@/components/layout/BottomNav';
import SideNav from '@/components/layout/SideNav';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'VibeCreature - Meet Your Soul Companion | AI Character Chat',
    template: '%s | VibeCreature',
  },
  description:
    'Discover and chat with unique AI characters. VibeCreature brings soul companions to life with deep personality, memory, and emotional intelligence.',
  keywords: [
    'AI chat',
    'AI character',
    'soul companion',
    'virtual companion',
    'character AI',
    'VibeCreature',
    'AI roleplay',
  ],
  authors: [{ name: 'VibeCreature' }],
  creator: 'VibeCreature',
  publisher: 'VibeCreature',
  metadataBase: new URL('https://vibecreature.com'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: 'https://vibecreature.com',
    siteName: 'VibeCreature',
    title: 'VibeCreature - Meet Your Soul Companion',
    description:
      'Discover and chat with unique AI characters. Deep personality, memory, and emotional intelligence.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'VibeCreature - AI Soul Companions',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VibeCreature - Meet Your Soul Companion',
    description:
      'Discover and chat with unique AI characters. Deep personality, memory, and emotional intelligence.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0a0a0a' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${playfair.variable} ${dmSans.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'VibeCreature',
              description:
                'Discover and chat with unique AI characters with deep personality, memory, and emotional intelligence.',
              url: 'https://vibecreature.com',
              applicationCategory: 'Entertainment',
              operatingSystem: 'Web',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'CNY',
              },
            }),
          }}
        />
      </head>
      <body
        className={`${dmSans.className} antialiased h-full`}
        style={{ backgroundColor: '#0a0a0a', color: '#e5e5e5' }}
      >
        {/* Subtle noise texture overlay */}
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            pointerEvents: 'none',
            opacity: 0.03,
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '256px 256px',
          }}
        />
        <div className="flex h-full relative z-0">
          <SideNav />
          <div className="flex-1 flex flex-col min-w-0 h-full">
            <main className="flex-1 overflow-y-auto no-scrollbar relative">
              {children}
            </main>
            <BottomNav />
          </div>
        </div>
      </body>
    </html>
  );
}
