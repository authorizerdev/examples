import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthorizerProvider } from "@authorizerdev/authorizer-react";
import App from "./App";

export default function Root() {
  return (
    <BrowserRouter>
      <AuthorizerProvider
        config={{
          authorizerURL: "https://authorizer-demo.herokuapp.com",
          redirectURL: window.location.origin
        }}
      >
        <App />
      </AuthorizerProvider>
    </BrowserRouter>
  );
}
