<!-- pages/Home.svelte -->
<script>
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import SkinButton from "../components/main/SkinButton.svelte";
  import BranchSwitcher from "../components/BranchSwitcher.svelte";
  import NoRiskLogoColor from "../images/norisk_logo_color.png";
  import CopyrightLabel from "../components/v2/CopyrightLabel.svelte";
  import HomeNavbar from "../components/v2/HomeNavbar.svelte";
  import HomeLeftNavbar from "../components/v2/HomeLeftNavbar.svelte";
</script>

<TransitionWrapper>
  <div class="home-wrapper">
    <HomeLeftNavbar />
    <HomeNavbar />
    <img class="pokemon-title" src={NoRiskLogoColor} alt="Pokemon Title">
    <BranchSwitcher />
    <SkinButton />
    <CopyrightLabel />
  </div>
  <h1 slot="footer">Blog Post Title</h1>
</TransitionWrapper>

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

    .pokemon-title {
        width: 80%;
        max-width: 400px;
        image-rendering: pixelated;
        -webkit-mask:linear-gradient(-60deg,#fff 40%,#0005 50%,#fff 60%) right/275% 100%; /* right/275% 100%: length and hight of mask */
        animation: effect 4.5s infinite; /* remove infinite to trigger once */
  }
  
   @keyframes effect {
   100% {-webkit-mask-position:left} /* transformation, 50 to swipe left->right->left; 100 to swipe left->right. 50 needs double effect duration */
  }
</style>
