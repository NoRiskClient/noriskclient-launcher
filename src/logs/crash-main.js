import "../app.css";
import Crash from "./Crash.svelte";

const crash = new Crash({
    target: document.getElementById("crash"),
    props: { }
});

export default crash;
