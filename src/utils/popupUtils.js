import { writable } from "svelte/store";

export const activePopup = writable(null);

export function closePopup() {
    activePopup.set(null);
}

export function openInfoPopup({
    title = null,
    content = "Empty!",
    closeButton = null,
    onClose = () => { },
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
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });
}

export function openConfirmPopup({
    title = null,
    content = "Empty!",
    confirmButton = null,
    closeButton = null,
    onConfirm = () => { },
    onCancel = () => { },
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
        closeButton: closeButton,
        onConfirm: onConfirm,
        onCancel: onCancel,
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });
}

export function openInputPopup({
    title = null,
    content = "Empty!",
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
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });
}

export function openErrorPopup({
    title = null,
    content = "Empty!",
    closeButton = null,
    onClose = () => { },
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
        height: height,
        width: width,
        titleFontSize: titleFontSize,
        contentFontSize: contentFontSize,
    });
}
