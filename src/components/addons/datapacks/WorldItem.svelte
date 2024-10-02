<script>
    export let icon = null;
    export let name;
    export let onClick = () => {};
  </script>

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="card" on:click={onClick}>
    <div class="content">
      <h2 class="icon" class:active={icon != null}>{icon}</h2>
      <h2>{name}</h2>
    </div>
    <p>&gt;</p>
  </div>

  <style>
    * {
      overflow: hidden;
    }

    .card {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 30px;
      margin: 10px;
      background-color: var(--background-contrast-color);
      border-radius: 10px;
      width: 600px;
      height: 75px;
      cursor: pointer;
      transition-duration: 150ms;
    }

    .card:hover {
      border-radius: 10px;
      transform: scaleX(1.05);
    }

    .content {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: flex-start;
      gap: 1em;
    }

    .icon.active {
      font-size: 30px;
      width: 40px;
    }

    .card h2 {
      justify-content: flex-start;
      font-size: 15px;
      font-weight: 400;
      line-break: anywhere;
    }

    .card p {
      font-size: 20px;
      transform: translateX(50px);
      opacity: 0;
      transition-duration: 150ms;
    }

    .card:hover p {
      opacity: 100%;
      transform: translateX(0px);
    }
  </style>
