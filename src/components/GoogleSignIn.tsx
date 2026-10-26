import { useEffect, useState } from 'react';
import { request } from '../lib/api';

export const googleErrors: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled. Try again or use your password.',
  expired: 'Google sign-in expired or could not be verified. Please try again.',
  failed: 'Google sign-in could not be completed. Please try again.',
  email: 'Google must provide a verified email address to sign in.',
  existing:
    'An account already uses this email. Sign in with your password, then connect Google in Profile.',
  suspended: 'This account is suspended. Contact the administrator.',
  link: 'Google could not be connected. Sign in again and use a Google account with the same email.',
};

export default function GoogleSignIn({
  link = false,
  role = 'guest',
  onError,
}: {
  link?: boolean;
  role?: string;
  onError: (message: string) => void;
}) {
  const [provider, setProvider] = useState<{ google: boolean; googleLinked: boolean }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request<{ google: boolean; googleLinked: boolean }>('/auth/providers')
      .then((value) => {
        if (active) setProvider(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!provider?.google) return null;
  if (link && provider.googleLinked)
    return <p>Google account connected. You can sign in with Google.</p>;
  return (
    <div className="google-sign-in">
      <button
        type="button"
        className="outline google-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          onError('');
          try {
            const { url } = await request<{ url: string }>('/auth/google/start', 'POST', {
              intent: link ? 'link' : 'login',
              role,
            });
            window.location.assign(url);
          } catch (error) {
            onError((error as Error).message);
            setBusy(false);
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.54 2.56 10.78l7.97-6.19Z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"
          />
        </svg>
        {busy ? 'Opening Google…' : link ? 'Connect Google account' : 'Continue with Google'}
      </button>
      {!link && <p className="auth-divider">or use your email and password</p>}
    </div>
  );
}
