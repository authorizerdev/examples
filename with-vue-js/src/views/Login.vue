<template>
	<div>
		<h1 :style="{ textAlign: 'center' }">Welcome to Authorizer</h1>
		<br />
		<authorizer-root :onLogin="onLogin" />
	</div>
</template>

<script>
import { inject, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AuthorizerRoot } from 'authorizer-vue-ts';
export default {
	name: 'Login',
	components: {
		'authorizer-root': AuthorizerRoot,
	},
	setup() {
		const useAuthorizer = inject('useAuthorizer');
		const { token } = useAuthorizer();
		const router = useRouter();
		const onLogin = () => {
			console.log('test login');
		};
		watch(
			token,
			(newvalue) => {
				if (newvalue) {
					console.log('access token ==>> ', token.value.access_token);
					router.push('/dashboard');
				}
			},
			{
				immediate: true,
			}
		);
		return {
			onLogin,
		};
	},
};
</script>

<style scoped></style>
