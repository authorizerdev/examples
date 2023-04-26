import { createApp } from 'vue';
import 'authorizer-vue-ts/dist/style.css';

import App from './App.vue';
import router from './router';
import './assets/main.css';

createApp(App).use(router).mount('#app');
