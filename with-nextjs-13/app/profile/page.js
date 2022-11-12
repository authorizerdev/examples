import { Authorizer } from '@authorizerdev/authorizer-js';
import authorizerConfig from '../../config/authorizer-config';
import { cookies } from 'next/headers';

const getUserData = async () => {
  const nextCookies = cookies();
  const token = nextCookies.get('authorizer-client-next').value;
  const authorizerRef = new Authorizer(authorizerConfig);

  return authorizerRef.getProfile({
    Authorization: `Bearer ${token}`,
  });
};

export default async function Profile() {
  const user = await getUserData();
  return user ? <pre>{JSON.stringify(user, null, 2)}</pre> : <h1>UNAUTH</h1>;
}
