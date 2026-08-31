import { Authorizer } from '@authorizerdev/authorizer-js';
import authorizerConfig from '../../../../lib/config/authorizer-config';
import { cookies } from 'next/headers';

const getUserData = async () => {
  const nextCookies = cookies();
  const tokenCookie = (await nextCookies).get('authorizer-client-next');
  const token = tokenCookie ? tokenCookie.value : null;
  const authorizerRef = new Authorizer(authorizerConfig);

  return authorizerRef.getProfile({
    Authorization: `Bearer ${token}`,
  });
};

export default async function Profile() {
  const user = await getUserData();
  return user ? <pre>{JSON.stringify(user, null, 2)}</pre> : null;
}