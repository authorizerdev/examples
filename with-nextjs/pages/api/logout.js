export default function logoutAPI(req, res) {
	res.setHeader(
		'Set-Cookie',
		`authorizer-client=;Expires=-1;Secure=true;HttpOnly=true;Path=/`
	);
	res.status(200).json({ message: 'logged out successfully' });
}
