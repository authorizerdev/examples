import { cookies } from 'next/headers';

export const generateAuthHeaders = async () => {
  const nextCookies = await cookies();
  const token = nextCookies.get('authorizer-client-next')?.value;
  const headers = new Headers();
  headers.append('Content-Type', 'application/json');
  headers.append('Authorization', `Bearer ${token}`);
  return headers;
};

export const validateUser = async () => {
  const headers = await generateAuthHeaders();
  console.log(headers);
  const response = await fetch('http://localhost:3001/health', {
    headers,
  });

  if (response.ok) return response.json();
  return false;
};

