import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DeadlineApp from "@/components/deadline-app";
import "./globals.css";
import "./product.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeadlineApp />
  </StrictMode>,
);
