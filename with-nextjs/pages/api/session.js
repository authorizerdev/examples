export default function sessionAPI(req, res) {
	const data = JSON.parse(req.body);
	const accessToken = data.accessToken;
	const expiresAt = data.accessTokenExpiresAt;
	if (!accessToken || !expiresAt) {
		res.status(401).json({
			message: 'Unauthorized',
		});
	} else {
		res.setHeader(
			'Set-Cookie',
			`authorizer-client=${accessToken};Expires=${new Date(
				expiresAt * 1000
			)};Secure=true;HttpOnly=true;Path=/`
		);
		res.status(200).json({ message: 'session created successfully' });
	}
}
