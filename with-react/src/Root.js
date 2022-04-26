import { BrowserRouter } from 'react-router-dom';
import { AuthorizerProvider } from '@authorizerdev/authorizer-react';
import App from './App';

export default function Root() {
	return (
		<BrowserRouter>
			<AuthorizerProvider
				config={{
					authorizerURL: 'https://demo.authorizer.dev',
					redirectURL: window.location.origin,
					clientID: '96fed66c-9779-4694-a79a-260fc489ce33',
				}}
			>
				<App />
			</AuthorizerProvider>
		</BrowserRouter>
	);
}
