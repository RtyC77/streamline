import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AboutPage } from "./pages/AboutPage";
import "./styles.css";
const aboutPath = location.pathname === "/sobre" || location.pathname === "/sobre/";
if (aboutPath) document.title = "Sobre o StreamLite";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {aboutPath ? <AboutPage /> : <App />}
  </React.StrictMode>,
);
