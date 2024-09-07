import { writable } from "svelte/store";
import { v4 as uuidv4 } from "uuid";

export const notifications = writable([]);

/*
  Hallo Kommentarleser, es ist 23 Uhr und ich habe probiert die Notifications wie in NoRiskClient zu coden
  mit hover und progressbar, anfang lief es auch GUT ABER DANN KAM ALLES JUNGE CHATGPT ABO ABGELAUFEN
  DER SCHREIBT NUR ROTZE DER STATE UPDATED SICH HELLWA WIRD JS SOWIEOS QUATSCH UND JETZT LASS ICH ES EINFAHC MIR SO EGAL FIX SELBST BITTE
  gute nacht <3
 */

export function addNotification(message, type = "ERROR", details = null, duration = 3000) {
  const id = uuidv4();
  notifications.update(n => [...n, { id, type, message, details, duration }]);
  setTimeout(() => removeNotification(id), duration);
}

export function removeNotification(id) {
  notifications.update(currentNotifications => {
    return currentNotifications.filter(notification => notification.id !== id);
  });
}
