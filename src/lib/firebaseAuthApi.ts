const API_KEY = 'AIzaSyBozDUIsznaE9S2J_0qXXcxgEGIOXaBW5M';

export async function createFirebaseUser(
  email: string,
  password: string
): Promise<{ uid: string; idToken: string }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to create user');
  }
  return { uid: data.localId, idToken: data.idToken };
}
