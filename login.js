import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";

document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    const errorMsg = document.getElementById('error-msg');

    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            window.location.href = "app.html";
        })
        .catch((error) => {
            errorMsg.style.display = 'block';
            errorMsg.innerText = "Erro: " + error.message;
            console.error(error);
        });
});
