import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
import { ToastProvider } from "./components/toast.jsx";
import App from "./App.jsx";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { iniciarSincronizacao } from "./api.js";

// Service worker: guarda a interface e as últimas consultas para uso sem conexão.
registerSW({ immediate: true });
iniciarSincronizacao();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
