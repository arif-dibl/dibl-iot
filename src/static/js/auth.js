function toggleForms() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    if (loginForm && signupForm) {
        loginForm.classList.toggle('hidden');
        signupForm.classList.toggle('hidden');
    }
}

function openTermsModal(event) {
    if (event) event.preventDefault();
    const modal = document.getElementById('terms-modal');
    if (modal) {
        modal.classList.remove('hidden');
        console.log("Terms modal opened");
    }
}

function closeTermsModal() {
    const modal = document.getElementById('terms-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

window.openTermsModal = openTermsModal;
window.closeTermsModal = closeTermsModal;

document.addEventListener('DOMContentLoaded', () => {
    const termsLink = document.getElementById('terms-link');
    if (termsLink) {
        termsLink.addEventListener('click', openTermsModal);
    }
});

window.onclick = function (event) {
    const modal = document.getElementById('terms-modal');
    if (event.target == modal) {
        closeTermsModal();
    }
}
