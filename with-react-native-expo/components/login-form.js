import { useState } from 'react';
import { StyleSheet, Text, View, TextInput, Button } from 'react-native';

export default function Login() {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');

	const handleLogin = async () => {
		const res = await fetch(`${AUTHORIZER_URL}/graphql`, {
			method: 'POST',
			credentials: 'omit',
			body: JSON.stringify({
				query: `
				mutation {
					login(params: { email: ${email}, password: ${password} }) {
						user {
							email
							given_name
							family_name
							picture
							roles
						}
						accessToken
						expires_at
						message
					}
				}
				`,
			}),
		});
		console.log(res.headers);

		const data = await res.json();
		console.log(data);
	};

	return (
		<View style={styles.container}>
			<Text style={{ marginBottom: 20, fontSize: 18, fontWeight: 'bold' }}>
				Login
			</Text>
			<TextInput
				style={styles.input}
				keyboardType="email-address"
				placeholder="Email"
				textContentType="emailAddress"
				onChange={(e) => setEmail(e.nativeEvent.text)}
			/>
			<TextInput
				style={styles.input}
				secureTextEntry
				keyboardType="visible-password"
				placeholder="Password"
				textContentType="password"
				onChange={(e) => setPassword(e.nativeEvent.text)}
			/>
			<Button title="Login" onPress={handleLogin} />
		</View>
	);
}

const styles = StyleSheet.create({
	input: {
		borderWidth: 1,
		borderColor: '#dfdfdf',
		padding: 5,
		backgroundColor: '#ffffff',
		height: 50,
		marginBottom: 10,
	},
	container: {
		width: '100%',
	},
});
