import { GMAIL_READ_SCOPE } from "./gmail";

type TokenResponse = { access_token?: string; error?: string; scope?: string };
type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: () => void;
      }): { requestAccessToken(options?: { prompt?: string }): void };
      revoke(token: string, callback: () => void): void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let loading: Promise<void> | null = null;
export function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (loading) return loading;
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Googleの接続画面を読み込めませんでした。"));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  loading = pending;
  return pending;
}

export function requestGmailAccess(
  clientId: string,
  callback: (token: string | null) => void,
): void {
  if (!window.google) throw new Error("Googleの接続画面を読み込み中です。");
  window.google.accounts.oauth2
    .initTokenClient({
      client_id: clientId,
      scope: GMAIL_READ_SCOPE,
      callback: (response) => {
        callback(
          response.access_token && response.scope?.includes(GMAIL_READ_SCOPE)
            ? response.access_token
            : null,
        );
      },
      error_callback: () => callback(null),
    })
    .requestAccessToken();
}

export function revokeGmailAccess(token: string): void {
  window.google?.accounts.oauth2.revoke(token, () => {});
}
