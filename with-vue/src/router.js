import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import Profile from './views/Profile.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Login },
    { path: '/profile', component: Profile },
  ],
});
