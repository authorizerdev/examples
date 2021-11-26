import { useState } from 'react';
import { Authorizer, useAuthorizer } from '@authorizerdev/authorizer-react';

function Root() {
	const [processing, setProcessing] = useState(false);
	const { user, authorizerRef, loading, setUser } = useAuthorizer();

	const onLogout = async () => {
		setProcessing(true);
		await authorizerRef.logout();
		setUser(null);
		setProcessing(false);
	};

	if (loading || processing) {
		return <h1>Loading...</h1>;
	}

	if (!user) {
		return (
			<div style={{ width: 700 }}>
				<h1>Demo App</h1>
				<Authorizer />
			</div>
		);
	}

	return (
		<div>
			<h2>Welcome {user.email} 👋</h2>
			<button onClick={onLogout}>Logout</button>
		</div>
	);
}

export default Root;
