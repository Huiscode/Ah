import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // archive/ 与 addon/ 为下线归档（插件已废除），不参与测试。
    exclude: ["archive/**", "addon/**", "node_modules/**"]
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") }
  }
});