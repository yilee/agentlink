import { createApp } from 'vue';
import App from './App.vue';
import { createStore } from './store.js';

// CSS imports (order matches original index.html)
import './css/base.css';
import './css/sidebar.css';
import './css/chat.css';
import './css/markdown.css';
import './css/tools.css';
import './css/ask-question.css';
import './css/input.css';
import './css/file-browser.css';
import './css/team.css';
import './css/responsive.css';
import './css/loop.css';
import './css/btw.css';

const app = createApp(App);
const store = createStore();
app.provide('store', store);
app.mount('#app');
