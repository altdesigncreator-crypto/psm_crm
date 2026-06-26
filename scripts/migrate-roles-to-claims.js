/**
 * Migrate all existing users' roles from Firestore to Firebase Custom Claims.
 *
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" to download serviceAccountKey.json
 *   3. Place serviceAccountKey.json in this scripts/ folder
 *   4. Run: npm install firebase-admin
 *   5. Run: node scripts/migrate-roles-to-claims.js
 *
 * This script will:
 *   - Read every document in the 'users' Firestore collection
 *   - Extract the 'role' field
 *   - Set it as a custom claim on the corresponding Firebase Auth user
 *   - Print a summary of migrated users
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Missing serviceAccountKey.json');
  console.error('   Download it from Firebase Console → Settings → Service Accounts.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

function normalizeRole(role) {
  if (!role) return 'sale';
  const lower = String(role).toLowerCase().trim();
  const map = {
    admin: 'admin',
    boss: 'chairman',
    chairman: 'chairman',
    sales: 'sale',
    sale: 'sale',
    project_manager: 'project_manager',
    projectmanager: 'project_manager',
    pm: 'project_manager',
  };
  return map[lower] || lower;
}

async function main() {
  const usersSnapshot = await db.collection('users').get();
  const total = usersSnapshot.size;

  if (total === 0) {
    console.log('⚠️  No users found in Firestore users collection.');
    await admin.app().delete();
    return;
  }

  console.log(`🔄 Found ${total} user(s) in Firestore. Starting migration...\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of usersSnapshot.docs) {
    const uid = docSnap.id;
    const data = docSnap.data();
    const rawRole = data.role;
    const normalizedRole = normalizeRole(rawRole);
    const email = data.email || '—';

    try {
      // Verify user exists in Firebase Auth
      const userRecord = await admin.auth().getUser(uid);
      await admin.auth().setCustomUserClaims(uid, { role: normalizedRole });
      success++;
      console.log(`✅ ${email}  →  role: "${normalizedRole}"  (uid: ${uid})`);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        skipped++;
        console.log(`⏭️  ${email}  →  no Auth account for uid ${uid}, skipped`);
      } else {
        failed++;
        console.error(`❌ ${email}  →  ERROR: ${err.message}`);
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Migration complete!`);
  console.log(`  Total users:  ${total}`);
  console.log(`  ✅ Success:   ${success}`);
  console.log(`  ⏭️  Skipped:   ${skipped}`);
  console.log(`  ❌ Failed:    ${failed}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📝 Next steps:');
  console.log('   1. Ask migrated users to log out and log back in.');
  console.log('   2. New tokens will include the custom claim automatically.');

  await admin.app().delete();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
