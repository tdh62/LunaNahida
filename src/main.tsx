import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import "./theme-tokens.css";

createRoot(document.getElementById("root")!).render(<App />);
