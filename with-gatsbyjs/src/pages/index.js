import { Authorizer, useAuthorizer } from '@authorizerdev/authorizer-react';
import * as React from 'react';
import { navigate } from 'gatsby';

const IndexPage = () => {
	const { loading, user } = useAuthorizer();
	React.useEffect(() => {
		if (!loading && user) {
			navigate('/private/dashboard');
		}
	}, [loading, user]);

	if (loading) {
		return <h3>loading...</h3>;
	}

	return (
		<main>
			<Authorizer
				onSignup={() => {
					navigate('/private/dashboard');
				}}
				onLogin={() => {
					navigate('/private/dashboard');
				}}
			/>
		</main>
	);
};

export default IndexPage;
