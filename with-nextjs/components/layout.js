import { useAuthorizer } from '@authorizerdev/authorizer-react';
import Head from 'next/head';
import Nav from './nav';

export default function Layout({ children }) {
	const { loading } = useAuthorizer();

	if (loading) {
		return <h1 className="text-2xl">Loading...</h1>;
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
}
