import { useAuthorizer } from '@authorizerdev/authorizer-react';
import Head from 'next/head';
import { useEffect } from 'react';
import Nav from './nav';

const Layout = ({ children }) => {
	const { loading, token } = useAuthorizer();

	if (loading) {
		return (
			<div className="h-screen w-screen flex justify-center items-center">
				<h1 className="text-2xl">Loading...</h1>
			</div>
		);
	}

	return (
		<div>
			<Head>
				<title>Create Next App</title>
				<link rel="icon" href="/favicon.ico" />
			</Head>

			<Nav />
			<div className="flex flex-col items-center justify-center min-h-screen py-2">
				{children}
			</div>
			<footer className="flex items-center justify-center w-full h-24 border-t">
				<a
					className="flex items-center justify-center"
					href="https://vercel.com?utm_source=create-next-app&utm_medium=default-template&utm_campaign=create-next-app"
					target="_blank"
					rel="noopener noreferrer"
				>
					Powered by{' '}
					<img src="/vercel.svg" alt="Vercel Logo" className="h-4 ml-2" />
				</a>
			</footer>
		</div>
	);
};

export default Layout;
