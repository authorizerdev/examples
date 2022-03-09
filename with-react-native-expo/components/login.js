import { StyleSheet, View, Button } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import base64 from 'react-native-base64';
import { AUTHORIZER_URL } from '../constants/authorizer';
import toQueryString from 'to-querystring';

export default function Login() {
	const handleLogin = async (dispatch) => {
		const redirectUrl = AuthSession.makeRedirectUri();
		const authURL = `${AUTHORIZER_URL}/app?state=${base64.encode(
			`{"redirectURL": "${redirectUrl}", "authorizerURL": "${AUTHORIZER_URL}"}`
		)}`;
		console.log({ authURL });

		let auth0URL =
			`https://dev-jt05ten5.us.auth0.com/authorize?` +
			toQueryString({
				client_id: 'FjeE3CweGGgi3RuIHD82kgkNDcczad8l',
				response_type: 'token id_token',
				scope: 'openid profile email',
				redirect_uri: redirectUrl,
				use_refresh_token: true,
			});

		console.log(auth0URL);
		const result = await AuthSession.startAsync({ authUrl: auth0URL });
		console.log('Result', result);
	};

	return (
		<View style={styles.container}>
			<Button title="Login" onPress={handleLogin} />
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		width: '100%',
	},
});
