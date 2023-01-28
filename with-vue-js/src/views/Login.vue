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
export default {
	name: 'Login',
	setup() {
		const useAuthorizer = inject('useAuthorizer');
		const {
			// user, config,
			token,
		} = useAuthorizer();
		function onLogin() {
			console.log('test login');
		}
		const router = useRouter();
		watch(
			token,
			function (newvalue) {
				if (newvalue) {
					router.push('/dashboard');
				}
			},
			{
				immediate: true,
			}
		);
		// watch(user, function (newvalue, oldvalue) {
		// 	console.log('old value from client ==>> ', oldvalue);
		// 	console.log('new value from client ==>> ', newvalue);
		// });
		// watch(config.is_google_login_enabled, function (newvalue, oldvalue) {
		// 	console.log('old value from client ==>> ', oldvalue);
		// 	console.log('new value from client ==>> ', newvalue);
		// });
		return {
			onLogin,
		};
	},
};
</script>

<style scoped></style>
