// shared/firebase.js – Firebase v10 modular (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, setDoc, onSnapshot, getDocs, getDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp, increment, runTransaction, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:"AIzaSyCx8bf74zylryw4LjX0xIQFY59P0t8Q_Go",
  authDomain:"sip-mentorship-slots.firebaseapp.com",
  projectId:"sip-mentorship-slots",
  storageBucket:"sip-mentorship-slots.firebasestorage.app",
  messagingSenderId:"256910468239",
  appId:"1:256910468239:web:8e1bb472beef65beebfcfa"
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const gg   = new GoogleAuthProvider();

export {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  collection, doc, addDoc, updateDoc, setDoc, onSnapshot, getDocs, getDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp, increment, runTransaction, arrayUnion
};
