import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "mapbox-gl/dist/mapbox-gl.css";
import "../app/globals.css";
import { MapExperience } from "../app/MapExperience";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapExperience />
  </StrictMode>,
);
