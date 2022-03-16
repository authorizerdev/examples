import { Authorizer } from '@authorizerdev/authorizer-js';
import Layout from '../components/layout';
import authorizerConfig from '../config/authorizer-config';

export default function Profile({ user }) {
	return (
		<div>
			<Layout>
				<pre>{JSON.stringify(user, null, 2)}</pre>
			</Layout>
		</div>
	);
}

export async function getServerSideProps({ req, res }) {
	const token = req.cookies['authorizer-client-next'];
	const authorizerRef = new Authorizer(authorizerConfig);

	const user = await authorizerRef.getProfile({
		Authorization: `Bearer ${token}`,
	});

	if (user) {
		return {
			props: { user }, // will be passed to the page component as props
		};
	} else {
		return {
			redirect: {
				destination: '/login',
				permanent: true,
			},
			props: {},
		};
	}
}
