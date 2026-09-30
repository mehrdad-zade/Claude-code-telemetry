import React from "react";
import ReactDOM from "react-dom/client";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import { App } from "./App.js";
import "./styles/index.css";

dayjs.extend(relativeTime);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
