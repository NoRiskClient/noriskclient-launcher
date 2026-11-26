const STACK_SIZE = 64;
const SHULKER_SIZE = STACK_SIZE * 27;
const PRECISION = 1e6;

const TOKEN = /\d+(?:\.\d+)?|[-+*/()]/g;

export function evaluate(input: string): number | null {
  const tokens = input.match(TOKEN);
  if (!tokens || tokens.join("") !== input.replace(/\s/g, "")) return null;
  let pos = 0;

  const factor = (): number => {
    const token = tokens[pos++];
    if (token === "-") return -factor();
    if (token === "(") {
      const value = sum();
      if (tokens[pos++] !== ")") throw new SyntaxError();
      return value;
    }
    const value = Number(token);
    if (token === undefined || Number.isNaN(value)) throw new SyntaxError();
    return value;
  };

  const product = (): number => {
    let value = factor();
    while (tokens[pos] === "*" || tokens[pos] === "/") {
      value = tokens[pos++] === "*" ? value * factor() : value / factor();
    }
    return value;
  };

  const sum = (): number => {
    let value = product();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      value = tokens[pos++] === "+" ? value + product() : value - product();
    }
    return value;
  };

  try {
    const value = sum();
    if (pos !== tokens.length || !Number.isFinite(value)) return null;
    return Math.round(value * PRECISION) / PRECISION;
  } catch {
    return null;
  }
}

export interface StackBreakdown {
  stacks: number;
  rest: number;
  shulkers: number;
}

export function stackBreakdown(items: number): StackBreakdown | null {
  if (!Number.isInteger(items) || items < STACK_SIZE) return null;
  return {
    stacks: Math.floor(items / STACK_SIZE),
    rest: items % STACK_SIZE,
    shulkers: Math.round((items / SHULKER_SIZE) * 100) / 100,
  };
}
