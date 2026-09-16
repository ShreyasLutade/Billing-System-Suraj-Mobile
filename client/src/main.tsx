import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ensureRandomUUID } from "./lib/id";
import "./index.css";

ensureRandomUUID();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
