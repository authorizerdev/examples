<script>
	import { getContext, onDestroy } from 'svelte';
	import { Authorizer } from '@authorizerdev/authorizer-svelte';
	import { browser } from '$app/environment';

	const store = getContext('authorizerContext');

	const unsubscribe = store.subscribe((/** @type {{ token: string; }} */ data) => {
		if (data.token && browser) {
			window.location.href = '/dashboard';
		}
	});

	onDestroy(unsubscribe);
</script>

<div class="login-container">
	<h1>Welcome to Authorizer</h1>
	<br />
	<Authorizer />
</div>

<style>
	.login-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
	}
</style>
