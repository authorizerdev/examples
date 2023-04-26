<template>
	<h1 :style="{ textAlign: 'center' }">Reset Password</h1>
	<br />
	<authorizer-reset-password />
</template>

<script>
import { AuthorizerResetPassword } from 'authorizer-vue-ts';
export default {
	name: 'ResetPassword',
	components: {
		'authorizer-reset-password': AuthorizerResetPassword,
	},
};
</script>

<style scoped></style>
