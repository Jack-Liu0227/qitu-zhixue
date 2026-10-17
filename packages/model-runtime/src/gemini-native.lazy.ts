import { lazyApi } from "./pi/api/lazy.js";

export const googleGeminiApi = () => lazyApi(() => import("./gemini-native.js"));
