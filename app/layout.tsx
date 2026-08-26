import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Kekaku · 我的计划',
  description: '月、周、日计划与 DeepSeek 智能拆解助手',
  openGraph: {
    title: 'Kekaku 计划',
    description: '月 · 周 · 日计划与 DeepSeek 智能拆解',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Kekaku 计划' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kekaku 计划',
    description: '月 · 周 · 日计划与 DeepSeek 智能拆解',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('kekaku-theme-v1');if(t==='dark'){document.documentElement.dataset.theme='dark';document.documentElement.style.colorScheme='dark'}}catch(e){}`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
