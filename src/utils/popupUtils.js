import { get, writable } from "svelte/store";
import { addNotification } from "../stores/notificationStore";
import { invoke } from "@tauri-apps/api";
import { pop, push, replace } from "svelte-spa-router";
import {isApiOnline, noriskLog} from "./noriskUtils";
import { translations } from "./translationUtils";

export const activePopup = writable(null);
export const changeLogs = writable(null);
export const announcements = writable(null);
export const lastViewedPopups = writable(null);
export const activeChangeLog = writable(null);
export const activeAnnouncement = writable(null);
export const activeAnnouncements = writable(null);

export function closePopup() {
    activePopup.set(null);
}

export function openInfoPopup({
    title = null,
    content = get(translations).popup.defaultContent,
    closeButton = null,
    onClose = () => { },
    allowEscape = true,
    height = null,
    width = null,
    titleFontSize = null,
    contentFontSize = null
}) {
    activePopup.set({
        type: "INFO",
        title: title,
        content: content,
        closeButton: closeButton,
        onClose: onClose,
        allowEscape: allowEscape,
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });

    return closePopup;
}

export function openConfirmPopup({
    title = null,
    content = get(translations).popup.defaultContent,
    confirmButton = null,
    cancelButton = null,
    onConfirm = () => { },
    onCancel = () => { },
    allowEscape = true,
    height = null,
    width = null,
    titleFontSize = null,
    contentFontSize = null
}) {
    activePopup.set({
        type: "CONFIRM",
        title: title,
        content: content,
        confirmButton: confirmButton,
        cancelButton: cancelButton,
        onConfirm: onConfirm,
        onCancel: onCancel,
        allowEscape: allowEscape,
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });

    return closePopup;
}

export function openInputPopup({
    title = null,
    content = get(translations).popup.defaultContent,
    inputType = "TEXT",
    inputName = null,
    inputValue = "",
    inputPlaceholder = "",
    confirmButton = null,
    closeButton = null,
    validateInput = (input) => { },
    liveValidation = true,
    onConfirm = (input) => { },
    onCancel = () => { },
    allowEscape = true,
    height = null,
    width = null,
    titleFontSize = null,
    contentFontSize = null
}) {
    activePopup.set({
        type: "INPUT",
        title: title,
        content: content,
        inputType: inputType.toUpperCase(),
        inputName: inputName ? inputName ?? title : "",
        inputValue: inputValue,
        inputPlaceholder: inputPlaceholder,
        confirmButton: confirmButton,
        closeButton: closeButton,
        validateInput: validateInput,
        liveValidation: liveValidation,
        onConfirm: onConfirm,
        onCancel: onCancel,
        allowEscape: allowEscape,
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });

    return closePopup;
}

export function openErrorPopup({
    title = null,
    content = get(translations).popup.defaultContent,
    closeButton = null,
    onClose = () => { },
    allowEscape = true,
    height = null,
    width = null,
    titleFontSize = null,
    contentFontSize = null
}) {
    activePopup.set({
        type: "ERROR",
        title: title,
        content: content,
        closeButton: closeButton,
        onClose: onClose,
        allowEscape: allowEscape,
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });

    return closePopup;
}

export function openLoadingPopup({
    content = "",
    onClose = () => { },
}) {
    activePopup.set({
        type: "INFO",
        title: "Loading",
        content: content,
        onClose: onClose
    });

    return closePopup;
}

// ChangeLog and Announcements

export async function getChangeLogs() {
    if (!get(isApiOnline)) return;
    await invoke("get_changelogs").then(result => {
        changeLogs.set(result);
        noriskLog("Change Logs: " + JSON.stringify(result));
    }).catch(reason => {
        addNotification(`Failed to fetch Change Logs: ${reason}`);
    });
}

export async function getAnnouncements() {
    if (!get(isApiOnline)) return;
    await invoke("get_announcements").then(result => {
        announcements.set(result);
        noriskLog("Announcements: " + JSON.stringify(result));
    }).catch(reason => {
        addNotification(`Failed to fetch Announcements: ${reason}`);
    });
}

export async function getLastViewedPopups() {
    await invoke("get_last_viewed_popups").then(result => {
        lastViewedPopups.set(result);
        noriskLog("Last Viewed Popups: " + JSON.stringify(result));
        if (get(announcements) == null) {
            announcements.subscribe(value => {
                if (value == null) return;
                if (get(changeLogs) != null) {
                    openChangeLogAndAnnouncements();
                }
            });
        }
        if (get(changeLogs) == null) {
            changeLogs.subscribe(value => {
                if (value == null) return;
                if (get(announcements) != null) {
                    openChangeLogAndAnnouncements();
                }
            });
        }

        if (get(announcements) != null && get(changeLogs) != null) {
            openChangeLogAndAnnouncements();
        }
    }).catch(reason => {
        addNotification(`Failed to fetch Last Viewed Popups: ${reason}`);
    });
}

export async function saveLastViewedPopups() {
    await invoke("store_last_viewed_popups", { lastViewedPopups: get(lastViewedPopups) }).catch(reason => {
        addNotification(`Failed to save Last Viewed Popups: ${reason}`);
    });
}

export async function openNextAnnouncement(first = false) {
    if (!first) {
        activeAnnouncements.update(value => {
            value?.shift();
            return value;
        });

        const hash = get(activeAnnouncement)?.title.hash() + get(activeAnnouncement)?.content.hash();
        lastViewedPopups.update(value => {
            value.announcements.push(hash);
            return value;
        });
        saveLastViewedPopups();
    }


    if (get(activeAnnouncements).length < 1) {
        activeAnnouncement.set(null);
        activeAnnouncements.set(null);

        if (get(activeChangeLog) != null) {
            replace("/changeLog");
        } else {
            pop();
        }
        return;
    };

    const nextAnnouncement = get(activeAnnouncements)[0] ?? null;
    activeAnnouncement.set(nextAnnouncement);
    if (first) {
        push("/announcement");
    }
}

// @ts-ignore
String.prototype.hash = function () {
    var hash = 0,
        i, chr;
    if (this.length === 0) return hash;
    for (i = 0; i < this.length; i++) {
        chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash.toString();
}

async function openChangeLogAndAnnouncements() {
    get(changeLogs).forEach(log => {
        if (get(lastViewedPopups)?.changelog != log.version) {
            activeChangeLog.set(log);
        }
    });

    let popups = [];
    get(announcements)?.forEach(announcement => {
        console.log(announcement.title.hash() + announcement.content.hash());
        if (!get(lastViewedPopups)?.announcements.includes(announcement.title.hash() + announcement.content.hash())) {
            popups.push(announcement);
        }
    });

    activeAnnouncements.set(popups);
    if (popups.length > 0) {
        openNextAnnouncement(true);
    }

    if (get(activeAnnouncements).length < 1 && get(activeChangeLog) != null) {
        push("/changeLog");
    }
}