export default function sessionAPI(req, res) {
	const data = JSON.parse(req.body);
	const accessToken = data?.access_token;
	const expiresAt = data?.expires_in;
	if (!accessToken || !expiresAt) {
		res.status(401).json({
			message: 'Unauthorized',
		});
	} else {
		res.setHeader(
			'Set-Cookie',
			`authorizer-client-next=${accessToken};Secure=true;HttpOnly=true;Path=/`
		);
		res.status(200).json({ message: 'session created successfully' });
	}
}
