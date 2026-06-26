/**
 * Firebase Admin SDK script to set custom claims (role) for users.
 *
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" to download serviceAccountKey.json
 *   3. Place serviceAccountKey.json in this scripts/ folder
 *   4. Run: npm install firebase-admin
 *   5. Run: node scripts/set-custom-claims.js
 *
 * Usage examples:
 *   node scripts/set-custom-claims.js --email admin@psm.com --role admin
 *   node scripts/set-custom-claims.js --email sale1@psm.com --role sale
 *   node scripts/set-custom-claims.js --email boss@psm.com --role chairman
 *   node scripts/set-custom-claims.js --email pm@psm.com --role project_manager
 *
 * Available roles: admin, chairman, project_manager, sale
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Parse CLI args
const args = process.argv.slice(2);
const emailArg = args.find((_, i) => args[i - 1] === '--email');
const roleArg = args.find((_, i) => args[i - 1] === '--role');

if (!emailArg || !roleArg) {
  console.error('Usage: node set-custom-claims.js --email <email> --role <role>');
  console.error('Roles: admin | chairman | project_manager | sale');
  process.exit(1);
}

const validRoles = ['admin', 'chairman', 'project_manager', 'sale'];
if (!validRoles.includes(roleArg)) {
  console.error(`Invalid role "${roleArg}". Valid: ${validRoles.join(', ')}`);
  process.exit(1);
}

// Initialize Admin SDK
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('Missing serviceAccountKey.json. Download it from Firebase Console → Settings → Service Accounts.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

async function main() {
  try {
    const user = await admin.auth().getUserByEmail(emailArg);
    await admin.auth().setCustomUserClaims(user.uid, { role: roleArg });
    console.log(`✅ Success! Set role "${roleArg}" for user ${emailArg} (uid: ${user.uid})`);
    console.log('   Custom claims will take effect on the next ID token refresh (automatic on login).');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await admin.app().delete();
  }
}

main();
