<script>
    import { onMount } from 'svelte';
    import { activePopup, closePopup as killPopup } from '../../utils/popupUtils.js';
    import ConfigTextInput from '../config/inputs/ConfigTextInput.svelte';
    import ConfigFolderInput from '../config/inputs/ConfigFolderInput.svelte';
    import ConfigFileInput from '../config/inputs/ConfigFileInput.svelte';
  
    let dialog; // HTMLDialogElement

    let popupTitle = $activePopup?.title ?? null;
    let popupContent = $activePopup?.content ?? 'Empty!';
    let popupType = $activePopup?.type ?? 'INFO';
    let popupInputName = $activePopup?.inputName ?? '';
    let popupInputType = $activePopup?.inputType ?? 'TEXT';
    let popupInputValue = $activePopup?.inputValue ?? '';
    let popupInputPlaceholder = $activePopup?.inputPlaceholder ?? '';
    let onClose = $activePopup?.onClose ?? (() => closePopup());
    let onCancel = $activePopup?.onCancel ?? (() => closePopup());
    let onConfirm = $activePopup?.onConfirm ?? (() => closePopup());
    let validateInput = $activePopup?.validateInput ?? (() => true);
    let liveValidation = $activePopup?.liveValidation ?? true;
    let popupConfirmButton = $activePopup?.confirmButton ?? 'Confirm';
    let popupCloseButton = $activePopup?.cancelButton ?? popupType == "INFO" ? "OK" : popupType == "CONFIRM" || popupType == "INPUT" ? "Cancel" : "Close";
    
    let popupHeight = $activePopup?.height ?? 22.5;
    let popupWidth = $activePopup?.width ?? 30;
    let popupTitleFontSize = $activePopup?.titleFontSize ?? '22.5px';
    let popupContentFontSize = $activePopup?.contentFontSize ?? '16.5px';
  
    $: if (dialog) dialog.showModal();
    let animateOutNow = false;
    let isInputValid = (popupType != "INPUT" || popupInputType != "TEXT") || !liveValidation;

    function closePopup() {
        if (popupType == "CONFIRM" || popupType == "INPUT") {
            onCancel();
        } else {
            onClose();
        }
        animateOut();
    }

    async function confirmPopup() {
        if (popupType == "CONFIRM") {
            onConfirm();
        } else if (popupType == "INPUT") {
            if ((isInputValid && liveValidation) || (!liveValidation && await validateInput(popupInputValue))) {
                onConfirm(popupInputValue);
            }
        }
        animateOut();
    }

    function animateOut() {
        animateOutNow = true;
        setTimeout(() => {
            dialog.close();
            killPopup();
        }, 100);
    }

    onMount(() => {
        if (popupType != "INPUT" || !liveValidation) return;
        document.getElementById("popup-input").addEventListener("input", async (event) => {
            const currentValue = event.target.value;
            isInputValid = await validateInput(currentValue);
        });
    });

    function preventSelection(event) {
      event.preventDefault();
    }
</script>
  
<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
    bind:this={dialog}
    class:animateOut={animateOutNow}
    class:animateIn={!animateOutNow}
    style={`height: ${popupHeight}em; width: ${popupWidth}em;`}
    on:close={closePopup}
    on:click|self={animateOut}
>
<div on:click|stopPropagation class="divider">
    <div class="header-wrapper">
        <h1 class="nes-font" style={`font-size: ${popupTitleFontSize};`} on:selectstart={preventSelection} on:mousedown={preventSelection}>{popupTitle ?? popupType}</h1>
        <h1 class="nes-font red-text-clickable close-button" on:click={closePopup}>X</h1>
    </div>
    <hr>
    <div class="popup-content-wrapper">
        <div class="content-wrapper" style={`height: ${popupHeight - 11}em;`}>
            <p class="content nes-font" style={`font-size: ${popupContentFontSize};`}>{@html popupContent}</p>
            {#if popupType == "INPUT"}
                {#if popupInputType == "TEXT"}
                    <ConfigTextInput id={"popup-input"} title={popupInputName} bind:value={popupInputValue} placeholder={popupInputPlaceholder} />
                {:else if popupInputType == "FOLDER"}
                    <ConfigFolderInput id={"popup-input"} title={popupInputName} bind:value={popupInputValue} />
                {:else if popupInputType == "FILE"}
                    <ConfigFileInput id={"popup-input"} title={popupInputName} bind:value={popupInputValue} />
                {/if}
            {/if}
        </div>
        <div class="buttons">
            <p 
                class="button nes-font enabled"
                class:red-text={popupType != "INFO"}
                class:primary-text={popupType == "INFO"}
                on:click={closePopup}
            >{popupCloseButton}</p>
            {#if popupType == "CONFIRM" || popupType == "INPUT"}
                <p class="button nes-font green-text" class:disabled={!isInputValid} class:enabled={isInputValid} on:click={() => isInputValid ? confirmPopup() : {}} title={!isInputValid ? "Invalid Input!" : ""}>{popupConfirmButton}</p>
            {/if}
        </div>
    </div>
</dialog>
  
<style>
    .header-wrapper {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        width: 100%;
        padding: 0.75em 0.25em;
    }

    .close-button {
        transition: transform 0.3s;
    }

    .close-button:hover {
        transition: transform 0.3s;
        transform: scale(1.2);
    }

    .popup-content-wrapper {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        margin-top: 1.5em;
        height: 100%;
        margin-bottom: 1em;
    }

    .content-wrapper {
        display: flex;
        flex-direction: column;
        justify-content: center;
        overflow-y: scroll;
        overflow-x: hidden;
        gap: 1em;
    }

    .buttons {
        display: flex;
        flex-direction: row;
        justify-content: space-around;
        align-items: center;
        height: 3em;
        gap: 1.5em;
        margin-top: 0.5em;
        margin-bottom: 0.5em;
    }

    .divider {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 1em;
    }
    
    dialog {
        background-color: var(--background-color);
        border: 5px solid black;
        border-radius: 0.2em;
        padding: 0;
        overflow: hidden;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    }

    dialog::backdrop {
        background: rgba(0, 0, 0, 0.3);
    }

    dialog > div {
        padding: 1em;
    }

    dialog[open]::backdrop {
        animation: fade 0.2s ease-out;
    }

    dialog.animateIn {
        animation: open 0.2s ease-out;
    }

    dialog.animateOut {
        animation: close 0.2s ease-out;
    }

    @keyframes fade {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    @keyframes open {
        from {
            transform: translate(-50%, 200%);
            opacity: 0;
        }
        to {
            transform: translate(-50%, -50%);
            opacity: 1;
        }
    }

    @keyframes close {
        from {
            transform: translate(-50%, -50%);
            opacity: 1;
        }
        to {
            transform: translate(-50%, 200%);
            opacity: 0;
        }
    }

    .nes-font {
        font-family: 'Press Start 2P', serif;
        user-select: none;
        cursor: default;
    }

    .content {
        text-align: center;
        line-height: 20px;
        padding: 5px;
        line-break: normal;
    }

    .button {
        cursor: pointer;
        font-size: 20px;
        transition-duration: 200ms;
    }

    .button.enabled:hover {
        transform: scale(1.15);
    }

    .button.disabled {
        cursor: not-allowed;
        opacity: 0.35;
    }
</style>
  