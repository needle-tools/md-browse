import App from "./App.svelte";
import { mount } from "svelte";

function mountApp() {
  const target = document.getElementById("app");
  if (!target) return null;
  return mount(App, { target });
}

const app = mountApp();

if (!app) {
  window.addEventListener("DOMContentLoaded", () => {
    mountApp();
  });
}

export default app;
