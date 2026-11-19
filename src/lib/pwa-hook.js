import { useSyncExternalStore } from "react";
import { pretplati, uzmiStanje } from "./pwa.js";

// Stanje PWA ljuske: { novaVerzija, bezVeze, imaPrompt, instalirana, ios }.
export const usePwa = () => useSyncExternalStore(pretplati, uzmiStanje);
