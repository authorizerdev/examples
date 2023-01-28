import { createApp } from 'vue';
import '../node_modules/authorizer-vue/dist/library.css';
import authorizer from 'authorizer-vue';

import App from './App.vue';
import router from './router';
import './assets/main.css';

createApp(App).use(router).use(authorizer).mount('#app');
