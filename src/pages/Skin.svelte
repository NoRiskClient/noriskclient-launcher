<script>
  import TransitionWrapper from "./TransitionWrapper.svelte";
  import SkinScreen from "../components/skin/SkinScreen.svelte";
</script>

<TransitionWrapper>
  <div>
    <SkinScreen></SkinScreen>
  </div>
</TransitionWrapper>

<!--
 Hallo Tim ich habe wirklich probiert es zu fixen, aber ich muss jetzt weitermachen damit wir ich schlafen kann ok
 ich setze mich nochmal dran wenn du mich pingst
 -->

<style>
    div:has(div) {
        width: 720px;
        height: 100%;
        overflow: hidden;
    }
</style>
