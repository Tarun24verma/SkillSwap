// Centralized API Client and Utilities for SkillSwap

const API = {
    getToken() {
        return localStorage.getItem('skillswap_token');
    },

    getUser() {
        try {
            return JSON.parse(localStorage.getItem('skillswap_user'));
        } catch (e) {
            return null;
        }
    },

    setAuth(token, user) {
        localStorage.setItem('skillswap_token', token);
        localStorage.setItem('skillswap_user', JSON.stringify(user));
    },

    clearAuth() {
        localStorage.removeItem('skillswap_token');
        localStorage.removeItem('skillswap_user');
        window.location.href = 'index.html';
    },

    async request(endpoint, options = {}) {
        const token = this.getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };

        try {
            const res = await fetch(endpoint, {
                ...options,
                headers
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                if (res.status === 401 && !endpoint.includes('/api/auth/login')) {
                    this.clearAuth();
                    throw new Error('Session expired. Please log in again.');
                }
                const errorMsg = data.error || (data.errors && data.errors.map(e => e.msg).join(', ')) || 'An unexpected error occurred';
                throw new Error(errorMsg);
            }

            return data;
        } catch (err) {
            console.error(`API Error [${endpoint}]:`, err);
            throw err;
        }
    },

    showToast(message, type = 'info') {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            toastContainer.style.zIndex = '9999';
            document.body.appendChild(toastContainer);
        }

        const bgClass = type === 'success' ? 'bg-success text-white' 
                      : type === 'danger' ? 'bg-danger text-white' 
                      : type === 'warning' ? 'bg-warning text-dark' 
                      : 'bg-primary text-white';

        const toastEl = document.createElement('div');
        toastEl.className = `toast align-items-center ${bgClass} border-0 shadow-lg`;
        toastEl.setAttribute('role', 'alert');
        toastEl.innerHTML = `
            <div class="d-flex">
                <div class="toast-body fw-semibold">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;
        toastContainer.appendChild(toastEl);
        const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
        toast.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    },

    renderNavbar(activePage = '') {
        const user = this.getUser();
        const navContainer = document.getElementById('navbar-container');
        if (!navContainer) return;

        navContainer.innerHTML = `
        <nav class="navbar navbar-expand-lg navbar-light bg-white border-bottom py-3 shadow-sm">
            <div class="container">
                <a class="navbar-brand d-flex align-items-center" href="${user ? 'dashboard.html' : 'index.html'}">
                    <span class="fs-4 me-2">⚡</span>
                    <span class="brand-gradient">SkillSwap</span>
                </a>
                <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav">
                    <span class="navbar-toggler-icon"></span>
                </button>
                <div class="collapse navbar-collapse" id="mainNav">
                    <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                        ${user ? `
                            <li class="nav-item">
                                <a class="nav-link ${activePage === 'dashboard' ? 'active fw-bold text-primary' : ''}" href="dashboard.html">Dashboard</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link ${activePage === 'search' ? 'active fw-bold text-primary' : ''}" href="search.html">Find Tutors</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link ${activePage === 'profile' ? 'active fw-bold text-primary' : ''}" href="profile.html">My Skills</a>
                            </li>
                        ` : ''}
                    </ul>
                    <div class="d-flex align-items-center gap-3">
                        ${user ? `
                            <div class="badge bg-indigo-100 text-primary border border-primary px-3 py-2 rounded-pill fs-6">
                                🪙 <span id="nav-credit-balance">${user.credits ?? 5}</span> Credits
                            </div>
                            <div class="dropdown">
                                <button class="btn btn-outline-secondary dropdown-toggle rounded-pill" type="button" data-bs-toggle="dropdown">
                                    👤 ${user.name || 'Account'}
                                </button>
                                <ul class="dropdown-menu dropdown-menu-end shadow">
                                    <li><a class="dropdown-item" href="profile.html">Settings & Skills</a></li>
                                    <li><hr class="dropdown-divider"></li>
                                    <li><button class="dropdown-item text-danger" onclick="API.clearAuth()">Sign Out</button></li>
                                </ul>
                            </div>
                        ` : `
                            <a href="index.html#auth" class="btn btn-primary rounded-pill px-4">Sign In / Register</a>
                        `}
                    </div>
                </div>
            </div>
        </nav>
        `;
    },

    async refreshProfileHeader() {
        if (!this.getToken()) return;
        try {
            const profile = await this.request('/api/profile');
            const user = this.getUser() || {};
            const updated = { ...user, ...profile };
            localStorage.setItem('skillswap_user', JSON.stringify(updated));
            const balanceEl = document.getElementById('nav-credit-balance');
            if (balanceEl) balanceEl.innerText = profile.credits;
            return profile;
        } catch (e) {
            console.warn('Could not refresh profile header:', e);
        }
    }
};
