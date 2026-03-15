import { ref } from 'vue';

export function useTheme() {
  const theme = ref(localStorage.getItem('agentlink-theme') || 'light');

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme.value);
    const link = document.getElementById('hljs-theme');
    if (link) link.href = theme.value === 'light'
      ? '/vendor/github.min.css'
      : '/vendor/github-dark.min.css';
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
    localStorage.setItem('agentlink-theme', theme.value);
    applyTheme();
  }

  // Apply immediately on creation
  applyTheme();

  return { theme, applyTheme, toggleTheme };
}
