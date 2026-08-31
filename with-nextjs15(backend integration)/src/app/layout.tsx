import type { Metadata } from 'next';
// import { Open_Sans } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/ClientProviders';
import Navbar from '@/components/Dashboard/Navbar/nav';

// const openSans = Open_Sans({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Authorizer!',
  description:
    'Authorizer is a simple, secure, and scalable authentication and authorization service that allows you to add authentication to your applications and APIs in just a few minutes.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  
  return (
    <html lang="en" className="bg-black text-white">
      <body >
        <AuthProvider>
        <Navbar /> {/* Pass token as a prop */}
        {children}
        </AuthProvider>
      </body>
    </html>
  );
}