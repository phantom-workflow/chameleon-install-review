import type {Metadata} from 'next';
import {Providers} from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chameleon Operations',
  description: 'Task-focused employee operations workspace for Chameleon.'
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
