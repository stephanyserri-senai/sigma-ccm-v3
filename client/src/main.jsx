import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth.jsx";
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
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
