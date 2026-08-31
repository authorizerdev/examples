import type { AuthToken } from '@authorizerdev/authorizer-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const POST = async (req: NextRequest, res: Response) => {
  (await cookies()).set('authorizer-client-next', '', {
    secure: true,
    expires: -1,
    httpOnly: true,
    path: '/',
  });
  return NextResponse.json(
    { message: 'Logged out successfully' },
    { status: 200 },
  );
};