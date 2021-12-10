import { AuthorizerProvider } from '@authorizerdev/authorizer-react';
import authorizerConfig from '../config/authorizer-config';
import '../styles/globals.css';

function MyApp({ Component, pageProps }) {
	return (
		<AuthorizerProvider
			config={authorizerConfig}
			onTokenCallback={async ({ token }) => {
				await fetch('/api/session', {
					method: 'POST',
					body: JSON.stringify(token),
				});
			}}
		>
			<Component {...pageProps} />
		</AuthorizerProvider>
	);
}

export default MyApp;
