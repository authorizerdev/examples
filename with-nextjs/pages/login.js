import { Authorizer, useAuthorizer } from '@authorizerdev/authorizer-react';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import Layout from '../components/Layout';

const Login = () => {
	const { token } = useAuthorizer();
	const router = useRouter();

	useEffect(() => {
		if (token) {
			router.push('/');
		}
		return () => {};
	}, [token]);

	return (
		<Layout>
			<main className="w-1/3">
				<Authorizer />
			</main>
		</Layout>
	);
};

export default Login;
