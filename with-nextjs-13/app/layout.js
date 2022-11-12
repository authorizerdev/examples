'use client';

import { AuthorizerProvider } from '@authorizerdev/authorizer-react';
import Head from 'next/head';
import Nav from '../components/nav';
import authorizerConfig from '../config/authorizer-config';
import '../styles/globals.css';

const onStateChangeCallback = async ({ token }) => {
  await fetch(
    '/api/session',
    {
      method: 'POST',
      body: JSON.stringify(token),
    },
    { cache: 'no-store' }
  );
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <AuthorizerProvider
        config={authorizerConfig}
        onStateChangeCallback={onStateChangeCallback}
      >
        <body>
          <Nav />
          <div className="flex flex-col items-center justify-center min-h-screen py-2">
            {children}
          </div>
          <footer className="flex items-center justify-center w-full h-24 border-t">
            <a
              className="flex items-center justify-center"
              href="https://vercel.com?utm_source=create-next-app&utm_medium=default-template&utm_campaign=create-next-app"
              target="_blank"
              rel="noopener noreferrer"
            >
              Powered by{' '}
              <img src="/vercel.svg" alt="Vercel Logo" className="h-4 ml-2" />
            </a>
          </footer>
        </body>
      </AuthorizerProvider>
    </html>
  );
}
