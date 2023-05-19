<script>
	import { AuthorizerResetPassword } from '@authorizerdev/authorizer-svelte';
	const resetHandler = () => {
		window.location.href = '/login';
	};
</script>

<h1 style="text-align: center;">Reset Password</h1>
<br />
<AuthorizerResetPassword onReset={resetHandler} />
