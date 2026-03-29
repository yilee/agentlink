import { createApp } from 'vue';
import App from './App.vue';

// CSS imports (order matches original index.html)
import './css/base.css';
import './css/sidebar.css';
import './css/chat.css';
import './css/markdown.css';
import './css/tools.css';
import './css/ask-question.css';
import './css/input.css';
import './css/file-browser.css';
import './css/git.css';
import './css/proxy.css';
import './css/team.css';
import './css/responsive.css';
import './css/loop.css';
import './css/btw.css';
import './css/toast.css';
import './css/confirm-dialog.css';
import './css/recap-feed.css';
import './css/recap-detail.css';
import './css/briefing.css';
import './css/devops.css';
import './css/project.css';
import './css/search.css';
import './css/chat-outline.css';

function mountApp() {
  createApp(App).mount('#app');
}

function showAccessDenied() {
  document.getElementById('app').innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#c00;font-size:1.2em;">Access denied. A @microsoft.com account is required.</div>';
}

const isProtectedRoute = window.location.pathname.startsWith('/ms/');
const isAuthCallback = window.location.pathname === '/auth/callback';

if (isProtectedRoute || isAuthCallback) {
  import('./auth/msalAuth.js').then(({ initAuth, requireLogin, isAllowedDomain, getUserPhoto }) => {
    initAuth().then((account) => {
      if (!account) {
        requireLogin();
      } else if (!isAllowedDomain(account)) {
        showAccessDenied();
      } else {
        // Extract first name from account.name (e.g. "Kailun Shi" → "Kailun")
        window.__entraUser = { firstName: (account.name || '').split(' ')[0] || account.username };
        // Mount app immediately — don't block on photo fetch
        mountApp();
        // Load photo in background
        getUserPhoto().then((photoUrl) => {
          if (photoUrl) {
            window.__entraUser.photoUrl = photoUrl;
            window.dispatchEvent(new CustomEvent('entra-photo-ready', { detail: photoUrl }));
          }
        }).catch(() => {});
      }
    });
  });
} else {
  mountApp();
}
