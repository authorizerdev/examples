<script>
	import { getContext, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	/**
	 * @type {{ token: string; user: any; loading: boolean; logout: Function; }}
	 */
	let state;

	export const store = getContext('authorizerContext');

	const unsubscribe = store.subscribe((/** @type {any} */ data) => {
		state = data;
		if (browser) {
			// to prevent error window is not defined, because it's SSR
			if (state.token) {
				window.location.href = '/dashboard';
			} else {
				window.location.href = '/login';
			}
		}
	});
	onDestroy(unsubscribe);
</script>
