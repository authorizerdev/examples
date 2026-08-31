'use client';

import { useEffect } from 'react';
import { Authorizer, useAuthorizer } from '@authorizerdev/authorizer-react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const { token } = useAuthorizer();
  const router = useRouter();
  useEffect(() => {
    if (token) {
      router.push('/');
    }
  }, [token]);
  return <Authorizer />;
}