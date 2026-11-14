import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { applyFont, applyTheme } from "./ui";
import "./index.css";

// Set the .dark class before the first paint so a dark-theme user gets no white flash.
applyTheme();
applyFont(); // pixel font unless the user picked the normal one in Settings -> Appearance

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
