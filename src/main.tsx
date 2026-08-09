import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/app.css";

try {
  const cachedTheme = localStorage.getItem("rvh.ui.theme");
  if (cachedTheme === "aurora" || cachedTheme === "light" || cachedTheme === "dark") {
    document.documentElement.dataset.theme = cachedTheme;
  }
} catch {
  // The HTML default prevents a dark startup flash when WebView storage is unavailable.
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
