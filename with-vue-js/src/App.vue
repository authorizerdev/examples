<template>
	<div :style="{ display: 'flex', justifyContent: 'center' }">
		<div
			:style="{
				width: '400px',
				margin: `10px auto`,
				border: `1px solid #D1D5DB`,
				padding: `25px 20px`,
				'border-radius': `5px`,
			}"
		>
			<authorizer-provider
				:config="{
					authorizerURL: 'https://demo.authorizer.dev',
					redirectURL: window.location.origin,
					clientID: '96fed66c-9779-4694-a79a-260fc489ce33',
				}"
				:onStateChangeCallback="stateChangeCallback"
			>
				<router-view />
			</authorizer-provider>
		</div>
	</div>
</template>

<script>
export default {
	setup() {
		const stateChangeCallback = (state) => {
			console.log('state changes from client ==>> ', state);
		};
		return {
			stateChangeCallback,
			window,
		};
	},
};
</script>

<style scoped></style>
