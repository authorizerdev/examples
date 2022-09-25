<script>
	import { AuthorizerProvider } from '@authorizerdev/authorizer-svelte';
	import '@authorizerdev/authorizer-svelte/styles/default.css';
</script>

<main class="container">
	<div class="component-warpper">
		<AuthorizerProvider
			config={{
				authorizerURL: 'http://localhost:8080',
				redirectURL: typeof window != 'undefined' ? window.location.origin : ``
			}}
		>
			<slot />
		</AuthorizerProvider>
	</div>
</main>

<style>
	main {
		font-family: -apple-system, system-ui, sans-serif;
		color: #374151;
		font-size: 14px;
	}
	.container {
		display: flex;
		height: 100vh;
		flex-direction: column;
		justify-content: center;
		align-items: center;
	}
	.component-warpper {
		display: flex;
		flex-direction: column;
		justify-content: center;
		width: 400px;
		margin: 10px auto;
		border: 1px solid #d1d5db;
		padding: 25px 20px;
		border-radius: 5px;
	}
</style>
