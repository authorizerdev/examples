import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import ResetPassword from './views/ResetPassword.vue';
import Dashboard from './views/Dashboard.vue';

export default createRouter({
	history: createWebHistory(),
	routes: [
		{
			path: '/',
			component: Login,
		},
		{
			path: '/reset-password',
			component: ResetPassword,
		},
		{
			path: '/dashboard',
			component: Dashboard,
		},
	],
});
