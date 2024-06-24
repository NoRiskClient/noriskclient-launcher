export function preventSelection(event) {
  event.preventDefault();
}

export function delay(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

