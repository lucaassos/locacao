// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js";

// TODO: Lucas, lembre-se de colocar suas chaves reais aqui
const firebaseConfig = {
  apiKey: "AIzaSyB98EcyksfAFZk7u_WTz7PRsndrqOWmP54",
  authDomain: "plantaolocacao-e98c4.firebaseapp.com",
  projectId: "plantaolocacao-e98c4",
  storageBucket: "plantaolocacao-e98c4.firebasestorage.app",
  messagingSenderId: "626540207577",
  appId: "1:626540207577:web:fff586598ed3ae2eeb4dc8"
};

// Inicializa e exporta as instâncias
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
