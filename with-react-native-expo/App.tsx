import * as AuthSession from 'expo-auth-session';
import jwtDecode from 'jwt-decode';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Authorizer } from '@authorizerdev/authorizer-js';

// You need to swap out the Authorizer client id and domain with the one from your Authorizer client.
// In your Authorizer client, you need to also add a url to your authorized redirect urls.

const useProxy = false;
const redirectUri = AuthSession.makeRedirectUri();
console.log(redirectUri);

// const authorizerClientID = '96fed66c-9779-4694-a79a-260fc489ce33';
const authorizerClientID = 'a549e2a1-0323-453b-ba3f-6487e91b30e7';
// const authorizerURL = 'https://demo.authorizer.dev';
const authorizerURL = 'https://visited-cleaning-hi-known.trycloudflare.com';
const authorizationEndpoint = `${authorizerURL}/authorize`;
const tokenEndpoint = `${authorizerURL}/oauth/token`;
const authorizerRef = new Authorizer({
  clientID: authorizerClientID,
  authorizerURL: authorizerURL,
  redirectURL: redirectUri,
});

const authorizerRefreshTokenKey = `authorizer_refresh_token`;

export default function App() {
  const [email, setEmail] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const [request, result, promptAsync] = AuthSession.useAuthRequest(
    {
      redirectUri,
      clientId: authorizerClientID,
      // id_token will return a JWT token
      responseType: 'code',
      // use offline access to get a refresh token and perform silent refresh in background
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      extraParams: {
        // ideally, this will be a random value
        nonce: 'nonce',
      },
      usePKCE: true,
    },
    { authorizationEndpoint }
  );

  console.log({ result });
  console.log({ request });

  // on init silently refresh token if it exists
  useEffect(() => {
    async function silentRefresh() {
      try {
        const refreshToken = await SecureStore.getItemAsync(
          authorizerRefreshTokenKey
        );
        console.log({ existingRefreshToken: refreshToken });
        if (refreshToken) {
          try {
            const { data, errors } = await authorizerRef.getToken({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
            });
            console.log({ data, errors });
            await SecureStore.setItemAsync(
              'authorizer_refresh_token',
              data?.refresh_token || ``
            );

            // get profile
            const { data: profileData, errors: profileErr } =
              await authorizerRef.getProfile({
                Authorization: `Bearer ${data?.access_token}`,
              });
            console.log({ profileData, profileErr });
            setEmail(profileData?.email);
          } catch (err) {
            console.error(JSON.stringify(err));
            await SecureStore.deleteItemAsync(authorizerRefreshTokenKey);
          }
        }
      } catch (error) {
        setEmail(undefined);
        await SecureStore.deleteItemAsync(authorizerRefreshTokenKey);
      } finally {
        setLoading(false);
      }
    }
    silentRefresh();
  }, []);

  useEffect(() => {
    async function setResult() {
      try {
        if (result && result.type === 'success') {
          if (result?.params.refresh_token) {
            await SecureStore.setItemAsync(
              authorizerRefreshTokenKey,
              result.params.refresh_token
            );
          }

          if (result.error) {
            Alert.alert(
              'Authentication error',
              result.params.error_description || 'something went wrong'
            );
            return;
          }

          console.log({ params: result.params });

          const codeRes = await AuthSession.exchangeCodeAsync(
            {
              code: result.params.code,
              redirectUri,
              clientId: authorizerClientID,
              extraParams: {
                code_verifier: request?.codeVerifier || '',
              },
            },
            { tokenEndpoint }
          );
          console.log({ codeRes });
          const { data, errors } = await authorizerRef.getToken({
            grant_type: 'refresh_token',
            refresh_token: codeRes?.refreshToken,
          });
          console.log({ data2: data, errors2: errors });
          await SecureStore.setItemAsync(
            'authorizer_refresh_token',
            data?.refresh_token || ``
          );

          // get profile
          const { data: profileData, errors: profileErr } =
            await authorizerRef.getProfile({
              Authorization: `Bearer ${codeRes?.accessToken}`,
            });
          console.log({ profileData2: profileData, profileErr2: profileErr });
          setEmail(profileData?.email);
        }
      } catch (err) {
        console.log(err);
      }
    }
    setResult();
  }, [result]);

  const handleLogout = async () => {
    setLoading(true);
    setEmail(undefined);

    try {
      const refreshToken = await SecureStore.getItemAsync(
        authorizerRefreshTokenKey
      );
      await authorizerRef.revokeToken({
        refresh_token: refreshToken || '',
      });
      await SecureStore.deleteItemAsync(authorizerRefreshTokenKey);
      await WebBrowser.openAuthSessionAsync(
        `${authorizerURL}/logout?redirect_uri=${redirectUri}`,
        'redirectUrl'
      );
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <Text>Loading...</Text>
      ) : (
        <View>
          {email ? (
            <>
              <Text style={styles.title}>You are logged in, {email}!</Text>
              <Button title="Log out" onPress={handleLogout} />
            </>
          ) : (
            <Button
              disabled={!request}
              title="Log in with Authorizer"
              onPress={() => promptAsync()}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    textAlign: 'center',
    marginTop: 40,
  },
});
