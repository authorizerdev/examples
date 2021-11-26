import { AuthorizerProvider } from '@authorizerdev/authorizer-react';
import './App.css';
import Root from './Root';

function App() {
	return (
		<div>
			<AuthorizerProvider
				config={{
					authorizerURL: `https://authorizer-demo.herokuapp.com`,
					redirectURL: window.location.origin,
				}}
			>
				<div
					style={{
						display: 'flex',
						justifyContent: 'center',
					}}
				>
					<Root />
				</div>
			</AuthorizerProvider>
		</div>
	);
}

export default App;
