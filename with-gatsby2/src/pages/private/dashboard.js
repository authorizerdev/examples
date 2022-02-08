import * as React from 'react';
import { useAuthorizer } from '@authorizerdev/authorizer-react';
import PrivateLayout from '../../components/private';

export default function Dashboard() {
	const { user } = useAuthorizer();
	return (
		<PrivateLayout>
			<code>{JSON.stringify(user, null, 2)}</code>
		</PrivateLayout>
	);
}
