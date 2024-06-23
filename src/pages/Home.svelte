<!-- pages/Home.svelte -->
<script>
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import SkinButton from "../components/main/SkinButton.svelte";
  import BranchSwitcher from "../components/BranchSwitcher.svelte";
  import NoRiskLogoColor from "../images/norisk_logo_color.png";
</script>

<TransitionWrapper>
  <div class="home-wrapper">
    <img class="pokemon-title" src={NoRiskLogoColor} alt="Pokemon Title">
    <BranchSwitcher />
    <SkinButton />
  </div>
</TransitionWrapper>

<style>
    .home-wrapper {
        border: 5px solid green;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-content: center;
        align-items: center;
    }

    .pokemon-title {
        width: 80%;
        max-width: 400px;
        image-rendering: pixelated;
        border: 1px solid red;
    }
</style>
