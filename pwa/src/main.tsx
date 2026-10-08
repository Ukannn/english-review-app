import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";
import "./sample.css";
import "./design.css";
import "./motion.css";

document.body.classList.add("editorial-review");

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
