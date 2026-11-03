import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { applyTheme } from "./ui";
import "./index.css";

// Set the .dark class before the first paint so a dark-theme user gets no white flash.
applyTheme();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
