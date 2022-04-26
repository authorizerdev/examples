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
				authorizerURL: 'https://demo.authorizer.dev',
				redirectURL:
					typeof window !== 'undefined' ? window.location.origin : '/',
				clientID: '96fed66c-9779-4694-a79a-260fc489ce33',
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
