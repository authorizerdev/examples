import { AuthorizerProvider } from '@authorizerdev/authorizer-react';
import 'tailwindcss/tailwind.css';
import authorizer from '../config/authorizer';

function MyApp({ Component, pageProps }) {
	return (
		<AuthorizerProvider
			config={authorizer}
			onTokenCallback={async ({ user, token }) => {
				console.log('called...', user);
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
