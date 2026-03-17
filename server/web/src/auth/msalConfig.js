function getEntraConfig() {
  const meta = document.querySelector('meta[name="entra-config"]');
  if (!meta?.content) return null;
  try { return JSON.parse(atob(meta.content)); } catch { return null; }
}

const entra = getEntraConfig();

export const msalConfig = {
  auth: {
    clientId: entra?.clientId || '',
    authority: `https://login.microsoftonline.com/${entra?.tenantId || 'common'}`,
    redirectUri: `${window.location.origin}/auth/callback`,
  },
  cache: { cacheLocation: 'localStorage' },
};

export const loginRequest = { scopes: ['openid', 'profile', 'email', 'User.Read'] };
