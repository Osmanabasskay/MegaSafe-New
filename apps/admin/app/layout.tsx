import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MegaSafe Admin',
  description: 'MegaSafe super admin dashboard',
};

export default function RootLayout(params: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{params.children}</body>
    </html>
  );
}
