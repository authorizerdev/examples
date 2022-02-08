import * as React from 'react';
import { AuthorizerProvider } from '@authorizerdev/authorizer-react';

// styles
const pageStyles = {
	color: '#232129',
	padding: 96,
	fontFamily: '-apple-system, Roboto, sans-serif, serif',
};

export default function Layout({ children }) {
	return (
		<AuthorizerProvider
			config={{
				authorizerURL: 'https://authorizer-demo.herokuapp.com',
				redirectURL:
					typeof window !== 'undefined' ? window.location.origin : '/',
			}}
		>
			<div
				style={{
					margin: `0 auto`,
					maxWidth: 650,
					padding: `0 1rem`,
					...pageStyles,
				}}
			>
				{children}
			</div>
		</AuthorizerProvider>
	);
}
