import { useAuthorizer } from '@authorizerdev/authorizer-react';
import Link from 'next/link';
import { useRouter } from 'next/router';

export default function Nav() {
	const { user, setUser, setToken, authorizerRef } = useAuthorizer();
	const router = useRouter();
	const onLogout = async () => {
		setUser(null);
		setToken(null);
		await authorizerRef.logout();
		await fetch('/api/logout');
		router.push('/');
	};
	return (
		<nav className="flex justify-between items-center w-full px-10 py-8 border-b">
			<div>
				<Link href="/">
					<a>
						<h1>Authorizer Demo</h1>
					</a>
				</Link>
			</div>
			<div>
				{user ? (
					<>
						<Link href="/profile">
							<a className="text-blue-500 hover:text-blue-400 mr-10">Profile</a>
						</Link>
						<button
							className="text-blue-500 hover:text-blue-400"
							onClick={onLogout}
						>
							Logout
						</button>
					</>
				) : (
					<>
						<Link href="/login">
							<a className="text-blue-500 hover:text-blue-400">Login</a>
						</Link>
					</>
				)}
			</div>
		</nav>
	);
}
