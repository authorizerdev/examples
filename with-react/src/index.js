import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import Root from "./Root";
import "@authorizerdev/authorizer-react/styles.css";
import "./styles.css";

const rootElement = document.getElementById("root");
createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
