import { StrictMode } from "react";
import ReactDOM from "react-dom";

import Root from "./Root";
import "./styles.css";

const rootElement = document.getElementById("root");
ReactDOM.render(
  <StrictMode>
    <Root />
  </StrictMode>,
  rootElement
);
