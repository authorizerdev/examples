import { createApp } from 'vue';
import authorizer from 'authorizer-vue';
import 'authorizer-vue/dist/library.css';

import App from './App.vue';
import router from './router';
import './assets/main.css';

createApp(App).use(router).use(authorizer).mount('#app');
