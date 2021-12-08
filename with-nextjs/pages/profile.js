import { Authorizer } from '@authorizerdev/authorizer-js';
import Layout from '../components/Layout';

const Profile = ({ user }) => {
	return (
		<Layout>
			<pre>{JSON.stringify(user, null, 2)}</pre>
		</Layout>
	);
};

export default Profile;

export async function getServerSideProps({ req, res }) {
	const authorizerRef = new Authorizer({
		authorizerURL: 'https://authorizer-demo.herokuapp.com',
		redirectURL: 'http://localhost:3000',
	});
	console.log(req.cookies);
	const token = req.cookies['authorizer-client'];
	console.log(token);
	try {
		if (token) {
			const session = await authorizerRef.getSession({
				Authorization: `Bearer ${token}`,
			});
			return {
				props: {
					user: session.user,
				},
			};
		} else {
			return {
				redirect: {
					destination: '/login',
					permanent: false,
				},
				props: { user: {} },
			};
		}
	} catch (err) {
		console.log(err);
		return {
			redirect: {
				destination: '/login',
				permanent: false,
			},
			props: { user: {} },
		};
	}
}
