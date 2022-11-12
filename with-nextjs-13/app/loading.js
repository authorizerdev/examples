'use client'

import { useAuthorizer } from '@authorizerdev/authorizer-react';

export default function Loading() {
  const { loading } = useAuthorizer();
  return loading ? <h1 className="text-2xl">Loading...</h1> : null;
}
