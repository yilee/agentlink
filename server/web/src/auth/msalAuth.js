import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig, loginRequest } from './msalConfig.js';

let msalInstance = null;

export async function initAuth() {
  msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  const response = await msalInstance.handleRedirectPromise();
  if (response) {
    msalInstance.setActiveAccount(response.account);
    // If we're on /auth/callback, redirect back to the original session page
    if (window.location.pathname === '/auth/callback') {
      const returnUrl = sessionStorage.getItem('entra_return_url');
      sessionStorage.removeItem('entra_return_url');
      if (returnUrl) {
        window.location.replace(returnUrl);
        return response.account; // won't matter, page is navigating away
      }
    }
    return response.account;
  }

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
    try {
      await msalInstance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      return accounts[0];
    } catch {
      return null;
    }
  }

  return null;
}

export async function requireLogin() {
  if (!msalInstance) return;
  // Save the current URL so we can return after login
  sessionStorage.setItem('entra_return_url', window.location.href);
  await msalInstance.loginRedirect(loginRequest);
}

export function getAccount() {
  if (!msalInstance) return null;
  return msalInstance.getActiveAccount();
}

export function isAllowedDomain(account) {
  if (!account || !account.username) return false;
  return account.username.toLowerCase().endsWith('@microsoft.com');
}

export async function getUserPhoto() {
  if (!msalInstance) return null;
  const account = msalInstance.getActiveAccount();
  if (!account) return null;
  try {
    const tokenResponse = await msalInstance.acquireTokenSilent({ scopes: ['User.Read'], account });
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${tokenResponse.accessToken}` },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export async function logout() {
  if (!msalInstance) return;
  await msalInstance.logoutRedirect();
}
