const express = require("express");
const authMiddleware = require("./auth_middleware");

const app = express();
const port = `3000`;

app.get("/", authMiddleware, (req, res) => {
  res.send("Hello World");
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
