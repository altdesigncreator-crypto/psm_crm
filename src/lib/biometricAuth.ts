// Biometric app-unlock via the WebAuthn platform authenticator (Face ID /
// Touch ID on iOS Safari, fingerprint / face unlock on Android Chrome).
//
// This does NOT create a brand-new Supabase session from nothing — there is
// no server-side relying-party verification here, only the browser-native
// "was this device's biometric sensor satisfied?" check. It is used purely
// as a local re-authentication gate on top of an already-persisted Supabase
// session (see "Remember me" in src/db/supabase.ts + BiometricLock.tsx):
// the session is what actually keeps the user signed in; biometrics decide
// whether *this* person is allowed to look at it right now.

const STORAGE_KEY = 'psm_biometric_credentials';

interface BiometricRecord {
  credentialId: string; // base64url-encoded rawId
  label: string;
  createdAt: string;
}

type BiometricStore = Record<string, BiometricRecord>;

function readStore(): BiometricStore {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStore(store: BiometricStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuf(b64url: string): ArrayBuffer {
  const pad = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

function randomChallenge(): ArrayBuffer {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr.buffer;
}

export function isBiometricSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isBiometricEnabledFor(userId: string): boolean {
  return !!readStore()[userId];
}

/** Register this device's Face ID / Touch ID / fingerprint as an unlock
 * credential for the given Supabase user. Prompts the OS biometric UI. */
export async function registerBiometric(userId: string, userEmail: string, userName: string): Promise<void> {
  if (!isBiometricSupported()) {
    throw new Error('This device or browser does not support biometric unlock.');
  }

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'PSM Sale CRM', id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userEmail,
        displayName: userName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Biometric setup was cancelled.');

  const store = readStore();
  store[userId] = {
    credentialId: bufToBase64Url(credential.rawId),
    label: userName,
    createdAt: new Date().toISOString(),
  };
  writeStore(store);
}

/** Prompt Face ID / Touch ID / fingerprint and resolve true only if the
 * platform authenticator confirms it's the enrolled person on this device. */
export async function verifyBiometric(userId: string): Promise<boolean> {
  const record = readStore()[userId];
  if (!record || !isBiometricSupported()) return false;

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        rpId: window.location.hostname,
        allowCredentials: [{ type: 'public-key', id: base64UrlToBuf(record.credentialId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

export function disableBiometric(userId: string): void {
  const store = readStore();
  delete store[userId];
  writeStore(store);
}
