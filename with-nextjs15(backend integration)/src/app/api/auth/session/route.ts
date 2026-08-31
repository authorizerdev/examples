import type { AuthToken } from '@authorizerdev/authorizer-js';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const POST = async (req: NextRequest, res: Response) => {
  const data = (await req.json()) as AuthToken | null;
  const accessToken = data?.access_token;
  const expiresAt = data?.expires_in;

  if (!accessToken || !expiresAt) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  } else {
    (await cookies()).set('authorizer-client-next', `${accessToken}`, {
      secure: true,
      httpOnly: true,
      path: '/',
    });
    return NextResponse.json(
      { message: 'Session created successfully' },
      { status: 200 },
    );
  }
};