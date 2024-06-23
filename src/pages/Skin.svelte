<script>
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import SkinScreen from "../components/skin/SkinScreen.svelte";
</script>

<TransitionWrapper>
  <SkinScreen></SkinScreen>
</TransitionWrapper>

<style>
    .box2 {
        width: 360px;
        height: 100%;
        overflow: auto;
        overflow-x: hidden;
        scrollbar-gutter: stable both-edges;
        background: green;
    }
</style>
