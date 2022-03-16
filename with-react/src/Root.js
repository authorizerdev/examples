import { BrowserRouter } from 'react-router-dom';
import { AuthorizerProvider } from '@authorizerdev/authorizer-react';
import App from './App';

export default function Root() {
	return (
		<BrowserRouter>
			<AuthorizerProvider
				config={{
					authorizerURL: 'https://authorizer-demo.herokuapp.com',
					redirectURL: window.location.origin,
					clientID: 'fec7f60f-efc0-42a7-9600-596daa4cc249',
				}}
			>
				<App />
			</AuthorizerProvider>
		</BrowserRouter>
	);
}
