import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api";
import { addNotification } from "./notificationStore.js";

export const launcherOptions = writable();

/*
  Hallo Kommentarleser, es ist 23 Uhr und ich habe probiert die Notifications wie in NoRiskClient zu coden
  mit hover und progressbar, anfang lief es auch GUT ABER DANN KAM ALLES JUNGE CHATGPT ABO ABGELAUFEN
  DER SCHREIBT NUR ROTZE DER STATE UPDATED SICH HELLWA WIRD JS SOWIEOS QUATSCH UND JETZT LASS ICH ES EINFAHC MIR SO EGAL FIX SELBST BITTE
  gute nacht <3
 */

export async function fetchOptions() {
  await invoke("get_options").then(async (result) => {
    launcherOptions.set(result);
  }).catch(reason => {
    addNotification(reason);
  });
}
