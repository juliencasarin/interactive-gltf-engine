import { StrictMode, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { ProjectsHubPage } from "./pages/ProjectsHubPage";
import { EditorPage } from "./pages/EditorPage";
import { PlayPage } from "./pages/PlayPage";

const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function TauriBootstrap() {
  useEffect(() => {
    const w = typeof window !== "undefined" ? (window as unknown as { __TAURI_INTERNALS__?: unknown }) : undefined;
    if (!w?.__TAURI_INTERNALS__) return;
    invoke("igltf_ensure_backend").catch(console.error);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <TauriBootstrap />
      <Routes>
        <Route path="/" element={<ProjectsHubPage />} />
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="/play/:id" element={<PlayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
