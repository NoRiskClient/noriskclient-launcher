<!-- pages/Home.svelte -->
<script>
	import { isWinterSeason } from './../../utils/noriskUtils.js';
  import SkinButton from "./widgets/SkinButton.svelte";
  import BranchSwitcher from "../BranchSwitcher.svelte";
  import NoRiskLogoColor from "../../images/norisk_logo_color.png";
  import NoRiskLogoColorSnow from "../../images/norisk_logo_color_snow.png";
  import CopyrightLabel from "./widgets/CopyrightLabel.svelte";
  import HomeNavbar from "./widgets/HomeNavbar.svelte";
  import HomeLeftNavbar from "./widgets/HomeLeftNavbar.svelte";
  import CreditModal from "./widgets/CreditsModal.svelte";

  let showCreditsModal = false;

  function showCredits() {
    showCreditsModal = true;
  }
</script>

<CreditModal bind:showModal={showCreditsModal} />
<div class="home-wrapper">
  <HomeLeftNavbar />
  <HomeNavbar />
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- DO NOT REMOVE THIS! Contact Tim if you have any questions! -->
  <div class="credits-click-field" on:click={showCredits}></div>
  <img class="pokemon-title title-effect" src={isWinterSeason ? NoRiskLogoColorSnow : NoRiskLogoColor} alt="Pokemon Title">
  <BranchSwitcher />
  <SkinButton />
  <CopyrightLabel />
</div>

<style>
  .home-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-content: center;
    align-items: center;
    gap: 1.2em;
  }

  .credits-click-field {
    position: absolute;
    width: 360px;
    height: 125px;
    top: 70px;
    cursor: pointer;
    z-index: 10;
  }

  .pokemon-title {
    width: 80%;
    max-width: 400px;
    image-rendering: pixelated;
    -webkit-user-drag: none;
    filter: drop-shadow(0 0 2px black);
  }
  
  .title-effect {
    -webkit-mask:linear-gradient(-60deg,#fff 40%,#0005 50%,#fff 60%) right/275% 100%; /* right/275% 100%: length and hight of mask */
    animation: effect 4.5s infinite; /* remove infinite to trigger once */
  }
  
  @keyframes effect {
    100% {
        -webkit-mask-position: left;
    }
  }
</style>
