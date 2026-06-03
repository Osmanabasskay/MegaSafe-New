import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mi Osusu Admin',
  description: 'Mi Osusu super admin dashboard',
};

export default function RootLayout(params: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{params.children}</body>
    </html>
  );
}
