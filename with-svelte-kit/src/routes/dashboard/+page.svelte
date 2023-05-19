<script>
	import { getContext, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	/**
	 * @type {{ token: string; user: any; loading: boolean; logout: Function; }}
	 */
	let state;

	const store = getContext('authorizerContext');
	const unsubscribe = store.subscribe((/** @type {any} */ data) => {
		state = data;
	});
	onDestroy(unsubscribe);
	const logoutHandler = async () => {
		await state.logout();
		if (browser) window.location.href = '/login';
	};
</script>

<div>
	<h1>Hey 👋,</h1>
	<p>Thank you for joining Authorizer demo app.</p>
	<p>
		Your email address is
		<a href={`mailto:${state.user?.email}`} style="color: #3B82F6;">
			{state.user?.email}
		</a>
	</p>
	<br />
	{#if state.loading}
		<h3>Processing....</h3>
	{:else}
		<h3 style="color: #3B82F6; cursor: pointer;" on:click={logoutHandler}>Logout</h3>
	{/if}
</div>
