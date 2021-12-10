import { useEffect } from 'react';
import { Authorizer, useAuthorizer } from '@authorizerdev/authorizer-react';
import { useRouter } from 'next/router';
import Layout from '../components/layout';

export default function Login() {
	const { token } = useAuthorizer();
	const router = useRouter();
	useEffect(() => {
		if (token) {
			router.push('/');
		}
	}, [token]);
	return (
		<Layout>
			<div className="w-full md:w-2/4">
				<Authorizer />
			</div>
		</Layout>
	);
}
