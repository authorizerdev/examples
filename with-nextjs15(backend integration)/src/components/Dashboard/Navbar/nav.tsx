'use client'

import { useAuthorizer } from '@authorizerdev/authorizer-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';



export default function Nav() {
  const { user, setUser, setToken, authorizerRef } = useAuthorizer();
  const router = useRouter();
  const onLogout = async () => {
    setUser(null);
    setToken(null);
    await authorizerRef.logout();
    await fetch('/api/auth/logout', {
        method: 'POST',
      });
    router.push('/');
  };

  const checkApi = async () => {};
  return (
    <nav className="flex justify-between items-center w-full px-10 py-8 border-b">
      <div>
      <Link href="/">
          <h1>Authorizer Demo</h1>
        </Link>
      </div>
      <div>
        {user ? (
          <>
            <Link
              href="/profile"
              className="text-blue-500 hover:text-blue-400 mr-10"
            >
              Profile
            </Link>
            <Link
              href="/check_api"
              className="text-blue-500 hover:text-blue-400"
            >
              Check_api
            </Link>
            <button
              className="text-blue-500 hover:text-blue-400"
              onClick={onLogout}
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-blue-500 hover:text-blue-400">
              Login
            </Link>
          </>
        )}

      </div>
    </nav>
  );
}