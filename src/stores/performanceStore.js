import { writable } from "svelte/store";

// window focus state
export const focusState = writable(true);

// ammount of snowflakes to render
export const snowFlakeCount = 30;
// kinda ugly but whatever
export const snowFlakes = function () {
  let snowflakes = [];
  for (let i = 0; i < snowFlakeCount; i++) {
    snowflakes.push('❄');
  }
  return snowflakes;
}();

export function setFocusState(value) {
  console.log('setFocusState', value);
  focusState.set(value);
}

