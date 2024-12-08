<script>
    import { listen } from "@tauri-apps/api/event";
    import { onMount } from "svelte";

    let progress = {
        type: "Minecraft Data...",
        file: "",
        total_type_entry_count: 0,
        current_type_entry_count: 0
    };
    let percentage;

    onMount(async () => {
        await listen("copy-mc-data", event => {
            progress = event.payload;
            const newPercentage = Math.min(Math.max(0, (progress.current_type_entry_count / progress.total_type_entry_count) * 100), 100).toFixed(2);
            percentage = newPercentage == 'NaN' ? 0 : newPercentage;
        });
    });
</script>

<div class="container">
    <h1 class="percentage">{percentage ?? 0}%</h1>
    <p class="info">Cloning {progress.type == 'NoRiskClient' ? `${progress.type} data` : progress.type}...</p>  
    <p class="currentFile">{progress.file}</p>
</div>

<style>
    .container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2em;
        height: 100%;
        width: 100%;
    }

    .percentage {
        font-size: 35px;
    }

    .info {
        font-size: 15px;
    }

    .currentFile {
        font-size: 12px;
    }
</style>