<template>
	<div>
		<h1>Hey 👋,</h1>
		<p>Thank you for joining Authorizer demo app.</p>
		<p>
			Your email address is
			<a
				href="`mailto:${user?.email}`"
				:style="{
					color: '#3B82F6',
				}"
			>
				{{ user?.email }}
			</a>
		</p>

		<br />
		<h3 v-if="loading">Processing....</h3>
		<h3
			v-else
			:style="{
				color: '#3B82F6',
				cursor: 'pointer',
			}"
			@click="logout"
		>
			Logout
		</h3>
	</div>
</template>

<script>
import { inject, watch } from 'vue';
import { useRouter } from 'vue-router';
export default {
	name: 'Dashboard',
	setup() {
		const useAuthorizer = inject('useAuthorizer');
		const { user, loading, token, logout } = useAuthorizer();
		const router = useRouter();
		watch(
			token,
			function (newvalue) {
				if (!newvalue) {
					router.push('/');
				}
			},
			{
				immediate: true,
			}
		);
		return {
			user,
			loading,
			logout,
		};
	},
};
</script>

<style scoped></style>
