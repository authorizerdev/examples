import { useAuthorizer } from '@authorizerdev/authorizer-react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const Nav = () => {
	const { user, setToken, setUser, authorizerRef } = useAuthorizer();
	const router = useRouter();

	const onLogout = async () => {
		setToken(null);
		setUser(null);
		await fetch('/api/logout');
		await authorizerRef.logout();

		router.push('/');
	};

	return (
		<div className="h-12 px-5 py-5 flex items-center justify-between border-b w-full">
			<div>
				<Link href="/">
					<a>
						<b className="text-xl">My app</b>
					</a>
				</Link>
			</div>
			<div>
				{user ? (
					<div className="flex items-center">
						{user.image ? (
							<img
								src={user.image}
								alt="user-profile"
								className="rounded-full h-10 w-10"
							/>
						) : (
							<div className="text-white rounded-full h-10 w-10 flex text-center justify-center items-center bg-blue-400">
								{user.email.charAt(0)}
							</div>
						)}
						<button
							onClick={onLogout}
							className="ml-5 hover:text-blue-500 text-blue-400"
						>
							Logout
						</button>
						<Link href="/profile">
							<a className="text-blue-400 ml-5">Profile</a>
						</Link>
					</div>
				) : (
					<>
						<Link href="/login">
							<a className="text-blue-400">Login</a>
						</Link>
					</>
				)}
			</div>
		</div>
	);
};

export default Nav;
