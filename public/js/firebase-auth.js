import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
    createUserWithEmailAndPassword,
    getAuth,
    reload,
    sendEmailVerification,
    GoogleAuthProvider,
    getRedirectResult,
    signInWithRedirect,
    signInWithEmailAndPassword,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const config = window.SKILLSWAP_FIREBASE_CONFIG;
const requiredConfig = ['apiKey', 'authDomain', 'projectId', 'appId'];
const configIsReady = config && requiredConfig.every(key =>
    typeof config[key] === 'string' &&
    config[key].length > 0 &&
    !config[key].startsWith('YOUR_')
);

const pendingProfileKey = 'skillswap_pending_profile';
const pendingGoogleProfileKey = 'skillswap_pending_google_profile';
let auth;
let pendingVerificationUser = null;
let resendTimer;

function getPendingProfile(email) {
    try {
        const profile = JSON.parse(localStorage.getItem(pendingProfileKey));
        return profile && profile.email === email.toLowerCase() ? profile : null;
    } catch (err) {
        localStorage.removeItem(pendingProfileKey);
        return null;
    }
}

function verificationActionSettings() {
    return {
        url: `${window.location.origin}/index.html?emailVerified=1`
    };
}

function showVerificationNotice(user) {
    pendingVerificationUser = user;
    document.getElementById('verificationNoticeText').textContent =
        `Verify ${user.email} using the link in your inbox, then sign in.`;
    document.getElementById('verificationNotice').classList.remove('d-none');
}

function hideVerificationNotice() {
    pendingVerificationUser = null;
    document.getElementById('verificationNotice').classList.add('d-none');
}

function authErrorMessage(error) {
    const messages = {
        'auth/email-already-in-use': 'An account already uses this email. Sign in and verify it to continue.',
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/invalid-login-credentials': 'Email or password is incorrect.',
        'auth/user-not-found': 'No account was found for this email.',
        'auth/wrong-password': 'Email or password is incorrect.',
        'auth/user-disabled': 'This account has been disabled. Contact support.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/weak-password': 'Choose a password with at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Wait a while and try again.',
        'auth/network-request-failed': 'Could not reach Firebase. Check your connection and try again.',
        'auth/unauthorized-domain': 'This site is not authorized for Firebase sign-in. Add its domain in Firebase Authentication settings.',
        'auth/operation-not-allowed': 'Google sign-in is not enabled for this Firebase project.'
    };
    if (error.code) {
        return messages[error.code] || `Firebase sign-in failed (${error.code}). Check the Firebase configuration and try again.`;
    }
    return error.message || 'Could not complete sign-in. Please try again.';
}

async function establishSkillSwapSession(firebaseUser, profile = {}) {
    if (!firebaseUser.email) {
        throw new Error('Your Google account must have an email address to continue.');
    }

    const email = firebaseUser.email.toLowerCase();
    const pendingProfile = getPendingProfile(email);
    const name = pendingProfile?.name || profile.name || firebaseUser.displayName || email.split('@')[0];
    const role = pendingProfile?.role || profile.role || 'both';
    const idToken = await firebaseUser.getIdToken(true);
    const result = await window.API.request('/api/auth/firebase-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ name, role })
    });

    window.API.setAuth(result.token, result.user);
    localStorage.removeItem(pendingProfileKey);
    window.API.showToast(`Welcome, ${result.user.name}!`, 'success');
    setTimeout(() => window.location.href = 'dashboard.html', 500);
}

function startResendCooldown(button) {
    let remaining = 60;
    button.disabled = true;
    button.textContent = `Resend in ${remaining}s`;
    if (resendTimer) clearInterval(resendTimer);

    resendTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(resendTimer);
            button.disabled = false;
            button.textContent = 'Resend verification link';
        } else {
            button.textContent = `Resend in ${remaining}s`;
        }
    }, 1000);
}

async function handleLogin(event) {
    event.preventDefault();
    const button = document.getElementById('loginBtn');
    button.disabled = true;
    button.textContent = 'Signing in...';

    try {
        const credential = await signInWithEmailAndPassword(
            auth,
            document.getElementById('loginEmail').value.trim(),
            document.getElementById('loginPassword').value
        );
        await reload(credential.user);

        if (!credential.user.emailVerified) {
            showVerificationNotice(credential.user);
            window.API.showToast('Verify your email before signing in.', 'warning');
            return;
        }

        hideVerificationNotice();
        await establishSkillSwapSession(credential.user);
    } catch (error) {
        window.API.showToast(authErrorMessage(error), 'danger');
    } finally {
        button.disabled = false;
        button.textContent = 'Sign In';
    }
}

async function handleGoogleSignIn() {
    const button = document.getElementById('googleSignInBtn');
    button.disabled = true;
    button.textContent = 'Redirecting to Google...';

    const registerTab = document.getElementById('register-pane').classList.contains('active');
    const profile = registerTab
        ? {
            name: document.getElementById('regName').value.trim(),
            role: document.getElementById('regRole').value
        }
        : {};

    try {
        sessionStorage.setItem(pendingGoogleProfileKey, JSON.stringify(profile));
        await signInWithRedirect(auth, new GoogleAuthProvider());
    } catch (error) {
        sessionStorage.removeItem(pendingGoogleProfileKey);
        window.API.showToast(authErrorMessage(error), 'danger');
    } finally {
        button.disabled = false;
        button.textContent = 'Continue with Google';
    }
}

async function handleRegistration(event) {
    event.preventDefault();
    const button = document.getElementById('regBtn');
    button.disabled = true;
    button.textContent = 'Creating account...';

    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('regRole').value;

    try {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        pendingVerificationUser = credential.user;
        await updateProfile(credential.user, { displayName: name });
        localStorage.setItem(pendingProfileKey, JSON.stringify({ email, name, role }));
        await sendEmailVerification(credential.user, verificationActionSettings());
        await signOut(auth);

        window.API.showToast(
            'Verification link sent. Verify your email, then sign in to activate your account and receive 5 credits.',
            'success'
        );
    } catch (error) {
        if (pendingVerificationUser && !pendingVerificationUser.emailVerified) {
            showVerificationNotice(pendingVerificationUser);
        }
        window.API.showToast(authErrorMessage(error), 'danger');
    } finally {
        button.disabled = false;
        button.textContent = 'Create Account & Send Verification Link';
    }
}

async function handleResendVerification() {
    const button = document.getElementById('resendVerificationBtn');
    if (!pendingVerificationUser) {
        window.API.showToast('Sign in first so we can resend your verification link.', 'warning');
        return;
    }

    button.disabled = true;
    button.textContent = 'Sending...';
    try {
        await sendEmailVerification(pendingVerificationUser, verificationActionSettings());
        window.API.showToast('A new verification link has been sent.', 'success');
        startResendCooldown(button);
    } catch (error) {
        button.disabled = false;
        button.textContent = 'Resend verification link';
        window.API.showToast(authErrorMessage(error), 'danger');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    window.API.renderNavbar();
    if (window.API.getToken()) {
        window.location.href = 'dashboard.html';
        return;
    }

    if (!configIsReady) {
        window.API.showToast('Add your Firebase web app config in js/firebase-config.js first.', 'danger');
        document.getElementById('loginBtn').disabled = true;
        document.getElementById('regBtn').disabled = true;
        document.getElementById('googleSignInBtn').disabled = true;
        return;
    }

    auth = getAuth(initializeApp(config));
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegistration);
    document.getElementById('googleSignInBtn').addEventListener('click', handleGoogleSignIn);
    document.getElementById('resendVerificationBtn').addEventListener('click', handleResendVerification);

    try {
        const credential = await getRedirectResult(auth);
        if (credential) {
            const profile = JSON.parse(sessionStorage.getItem(pendingGoogleProfileKey) || '{}');
            sessionStorage.removeItem(pendingGoogleProfileKey);
            hideVerificationNotice();
            await establishSkillSwapSession(credential.user, profile);
        }
    } catch (error) {
        sessionStorage.removeItem(pendingGoogleProfileKey);
        window.API.showToast(authErrorMessage(error), 'danger');
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('emailVerified') === '1') {
        document.getElementById('login-tab').click();
        window.API.showToast('Email verified. Sign in to activate your SkillSwap account and claim 5 credits.', 'success');
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
    }
});
