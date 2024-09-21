<script>
  import { appWindow } from "@tauri-apps/api/window";

  function onClose() {
    appWindow.close()
  }

  function onMinimize() {
    appWindow.minimize()
  }
</script>

<div class="window-control" data-tauri-drag-region>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="icon-wrapper" on:click={onMinimize}>
    <span class="icon minimize"/>
  </div>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="icon-wrapper" on:click={onClose}>
    <span class="icon close"/>
  </div>
</div>

<style>
    .window-control {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: right;
        padding: 0.75rem 0.75rem 0 0;
        gap: 0.5rem;
    }

    .icon-wrapper {
        display: block;
        width: 0.8rem;
        height: 0.8rem;
        position: relative;
    }

    .icon-wrapper:hover {
        cursor: pointer;
    }

    .icon {
        position: absolute;
        background-color: #e8e8e8;
        transition: background-color 0.4s, transform 0.3s;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
    }

    .close {
        clip-path: polygon(25% 5%, 5% 25%, 35% 50%, 5% 75%, 25% 95%, 50% 65%, 75% 95%, 95% 75%, 65% 50%, 95% 25%, 75% 5%, 50% 35%);
        border-radius: 12px;
    }

    .icon-wrapper:hover > .close {
        background-color: red;
        transform: scale(1.1);
    }

    .minimize {
        clip-path: inset(40% 10% 40% 10%);
    }

    .icon-wrapper:hover > .minimize {
        background-color: #7a7777;
        transform: scale(1.1);
    }
</style>

