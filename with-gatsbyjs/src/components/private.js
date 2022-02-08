import * as React from 'react';
import { useAuthorizer } from '@authorizerdev/authorizer-react';
import { navigate } from 'gatsby';

export default function PrivateLayout({ children }) {
	const { user, loading, authorizerRef, setUser } = useAuthorizer();
	React.useEffect(() => {
		if (!loading && !user) {
			navigate('/');
		}
	}, [loading, user]);

	const handleLogout = async () => {
		await authorizerRef.logout();
		setUser(null);
		navigate('/');
	};

	if (loading) {
		return <h3>loading...</h3>;
	}

	return (
		<div
			style={{
				margin: `0 auto`,
				maxWidth: 650,
				padding: `0 1rem`,
			}}
		>
			<button onClick={handleLogout}>Logout</button>
			{children}
		</div>
	);
}
