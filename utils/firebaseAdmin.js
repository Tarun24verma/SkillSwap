const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let firebaseAuth;

exports.getFirebaseAuth = () => {
    if (firebaseAuth) return firebaseAuth;

    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        } catch (err) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON');
        }
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        serviceAccount = JSON.parse(
            fs.readFileSync(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH), 'utf8')
        );
    } else {
        throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH');
    }

    if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
        throw new Error('Firebase service-account credentials must be a JSON object');
    }

    const requiredFields = ['project_id', 'client_email', 'private_key'];
    const missingFields = requiredFields.filter(field =>
        typeof serviceAccount[field] !== 'string' || serviceAccount[field].trim().length === 0
    );
    if (missingFields.length > 0) {
        throw new Error(
            `Firebase service-account JSON is missing required string fields: ${missingFields.join(', ')}`
        );
    }

    if (serviceAccount.type !== 'service_account') {
        throw new Error('Firebase credentials must be a service-account JSON file');
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    firebaseAuth = admin.auth();
    return firebaseAuth;
};
