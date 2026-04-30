import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { EditorPage } from "./pages/EditorPage";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/editor/test" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
