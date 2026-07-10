import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import '@authorizerdev/authorizer-vue/dist/style.css';

createApp(App).use(router).mount('#app');
