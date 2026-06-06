/**
 * Molang evaluator covering the Bedrock subset that emote + particle authors
 * actually emit. The grammar is far broader than what the parser used to
 * support — particles use full statement chains, variable assignments,
 * ternaries, comparisons, multi-arg `math.*` functions, and per-particle /
 * per-emitter context variables.
 *
 * Supported:
 *   - Statement chains:  expr1; expr2; return expr3;   (last value or return)
 *   - Assignment:        variable.x = expr | v.x = expr | temp.x = expr
 *   - Ternary:           cond ? a : b
 *   - Logical:           a || b   a && b   !a
 *   - Equality:          a == b   a != b
 *   - Comparison:        a < b    a <= b   a > b   a >= b
 *   - Arithmetic:        + - * / %  (with standard precedence + parens)
 *   - Unary:             -x   +x   !x
 *   - Numeric literals + identifiers (case-insensitive, dotted: math.foo)
 *   - Function calls:    name(arg1, arg2, ...)
 *
 * Functions:
 *   math.sin/cos/abs/sqrt/floor/ceil/round  — single-arg
 *   math.random(a, b) / math.random_integer(a, b) — uniform [a, b)
 *   math.clamp(x, min, max), math.lerp(a, b, t), math.lerprotate(a, b, t)
 *   math.mod(a, b), math.pow(a, b), math.exp(x), math.ln(x)
 *   math.max(a, b), math.min(a, b)
 *   math.die_roll(num, low, high), math.die_roll_integer(num, low, high)
 *   math.hermite_blend(t)
 *   math.asin/acos/atan/atan2  (atan2 takes 2 args, asin/acos/atan return degrees)
 *
 * Variables (read from MolangContext):
 *   query.anim_time / t.anim_time / q.anim_time   → animTime
 *   query.particle_age, query.particle_lifetime, query.particle_speed
 *   query.emitter_age, query.emitter_lifetime
 *   variable.particle_random_1..4 / v.particle_random_1..4
 *   variable.emitter_random_1..4 / v.emitter_random_1..4
 *   math.pi
 *   variable.<name> / v.<name> / temp.<name>      → ctx.variables map (default 0)
 *
 * Bedrock quirks honoured:
 *   - math.sin / math.cos arguments are degrees (Bedrock spec)
 *   - math.asin/acos/atan/atan2 return degrees
 *   - Identifiers are normalised to lowercase ("Math.Floor" === "math.floor")
 *   - Boolean ops return 1.0 / 0.0 (Molang has no real booleans)
 *
 * Parsed ASTs are cached by source string so repeated sampling stays fast.
 */

import type { ParticleCurve } from "./particles/types";

// ---------- Public API ----------

export interface MolangContext {
  /** `query.anim_time` — seconds. */
  animTime?: number;

  // Particle scope
  particleAge?: number;
  particleLifetime?: number;
  particleSpeed?: number;
  /** Tuple of [particle_random_1, ..., particle_random_4] — fixed random per particle. */
  particleRandom?: [number, number, number, number];

  // Emitter scope
  emitterAge?: number;
  emitterLifetime?: number;
  emitterRandom?: [number, number, number, number];

  /** User-defined `variable.foo`/`v.foo`/`temp.foo` storage. Pass a Map per evaluation
   *  scope so assignments are visible to later expressions on the same particle. */
  variables?: Map<string, number>;

  /** Named curves (Bedrock `curves` block). Looked up via `curves.<name>` reads. */
  curves?: Record<string, ParticleCurve>;
}

const astCache = new Map<string, AstNode | null>();

export function evalMolang(expr: number | string, ctx: MolangContext = {}): number {
  if (typeof expr === "number") return expr;
  const ast = parseMolang(expr);
  if (!ast) return 0;
  return evaluate(ast, ctx);
}

/** Truthy when the expression evaluates to non-zero. Matches Bedrock booleans. */
export function evalMolangBoolean(
  expr: number | string,
  ctx: MolangContext = {}
): boolean {
  return Math.abs(evalMolang(expr, ctx)) > 1e-9;
}

export function parseMolang(source: string): AstNode | null {
  if (astCache.has(source)) return astCache.get(source) ?? null;
  let ast: AstNode | null = null;
  try {
    const tokens = tokenize(source);
    const parser = new Parser(tokens);
    ast = parser.parseProgram();
    if (parser.peek() !== undefined) ast = null;
  } catch {
    ast = null;
  }
  astCache.set(source, ast);
  return ast;
}

// ---------- AST ----------

type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "<" | "<=" | ">" | ">="
  | "==" | "!="
  | "&&" | "||";

export type AstNode =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "fn"; name: string; args: AstNode[] }
  | { kind: "binary"; op: BinaryOp; lhs: AstNode; rhs: AstNode }
  | { kind: "neg"; expr: AstNode }
  | { kind: "not"; expr: AstNode }
  | { kind: "cond"; cond: AstNode; then: AstNode; else: AstNode }
  | { kind: "assign"; name: string; expr: AstNode }
  | { kind: "seq"; items: AstNode[] }
  | { kind: "return"; expr: AstNode };

// ---------- Tokenizer ----------

type Token =
  | { kind: "num"; value: number }
  | { kind: "ident"; value: string }
  | {
      kind: "op";
      value:
        | "+" | "-" | "*" | "/" | "%"
        | "<" | "<=" | ">" | ">="
        | "==" | "!="
        | "&&" | "||"
        | "=" | "!"
        | "?" | ":";
    }
  | { kind: "lp" }
  | { kind: "rp" }
  | { kind: "comma" }
  | { kind: "semi" };

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    if (c === ";") {
      tokens.push({ kind: "semi" });
      i++;
      continue;
    }
    if (c === "?") {
      tokens.push({ kind: "op", value: "?" });
      i++;
      continue;
    }
    if (c === ":") {
      tokens.push({ kind: "op", value: ":" });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%") {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    if (c === "<") {
      if (s[i + 1] === "=") {
        tokens.push({ kind: "op", value: "<=" });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "<" });
        i++;
      }
      continue;
    }
    if (c === ">") {
      if (s[i + 1] === "=") {
        tokens.push({ kind: "op", value: ">=" });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: ">" });
        i++;
      }
      continue;
    }
    if (c === "=") {
      if (s[i + 1] === "=") {
        tokens.push({ kind: "op", value: "==" });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "=" });
        i++;
      }
      continue;
    }
    if (c === "!") {
      if (s[i + 1] === "=") {
        tokens.push({ kind: "op", value: "!=" });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "!" });
        i++;
      }
      continue;
    }
    if (c === "&" && s[i + 1] === "&") {
      tokens.push({ kind: "op", value: "&&" });
      i += 2;
      continue;
    }
    if (c === "|" && s[i + 1] === "|") {
      tokens.push({ kind: "op", value: "||" });
      i += 2;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push({ kind: "num", value: Number.parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_.]/.test(s[j])) j++;
      tokens.push({ kind: "ident", value: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    // Unknown char — skip.
    i++;
  }
  return tokens;
}

// ---------- Parser ----------

class Parser {
  pos = 0;
  constructor(public tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  advance(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error("unexpected end of input");
    return t;
  }
  match(predicate: (t: Token) => boolean): boolean {
    const t = this.peek();
    if (t && predicate(t)) {
      this.pos++;
      return true;
    }
    return false;
  }

  /** Top-level: optionally a sequence of statements separated by `;`. */
  parseProgram(): AstNode {
    const items: AstNode[] = [];
    items.push(this.parseStatement());
    while (this.peek()?.kind === "semi") {
      this.advance();
      if (this.peek() === undefined) break; // trailing `;`
      items.push(this.parseStatement());
    }
    if (items.length === 1) return items[0];
    return { kind: "seq", items };
  }

  parseStatement(): AstNode {
    const t = this.peek();
    if (t?.kind === "ident" && t.value === "return") {
      this.advance();
      const expr = this.parseExpr();
      return { kind: "return", expr };
    }
    return this.parseExpr();
  }

  /** Lowest precedence: assignment. `variable.x = expr` is right-associative. */
  parseExpr(): AstNode {
    const lhs = this.parseTernary();
    const t = this.peek();
    if (t?.kind === "op" && t.value === "=") {
      this.advance();
      if (lhs.kind !== "var") {
        throw new Error("assignment target must be a variable");
      }
      const rhs = this.parseExpr();
      return { kind: "assign", name: lhs.name, expr: rhs };
    }
    return lhs;
  }

  parseTernary(): AstNode {
    const cond = this.parseLogicalOr();
    const t = this.peek();
    if (t?.kind === "op" && t.value === "?") {
      this.advance();
      const then = this.parseExpr();
      const colon = this.peek();
      if (!(colon?.kind === "op" && colon.value === ":")) {
        throw new Error("expected ':' in ternary");
      }
      this.advance();
      const elseExpr = this.parseExpr();
      return { kind: "cond", cond, then, else: elseExpr };
    }
    return cond;
  }

  parseLogicalOr(): AstNode {
    let lhs = this.parseLogicalAnd();
    while (true) {
      const t = this.peek();
      if (!(t?.kind === "op" && t.value === "||")) break;
      this.advance();
      const rhs = this.parseLogicalAnd();
      lhs = { kind: "binary", op: "||", lhs, rhs };
    }
    return lhs;
  }

  parseLogicalAnd(): AstNode {
    let lhs = this.parseEquality();
    while (true) {
      const t = this.peek();
      if (!(t?.kind === "op" && t.value === "&&")) break;
      this.advance();
      const rhs = this.parseEquality();
      lhs = { kind: "binary", op: "&&", lhs, rhs };
    }
    return lhs;
  }

  parseEquality(): AstNode {
    let lhs = this.parseComparison();
    while (true) {
      const t = this.peek();
      if (!(t?.kind === "op" && (t.value === "==" || t.value === "!="))) break;
      this.advance();
      const rhs = this.parseComparison();
      lhs = { kind: "binary", op: t.value, lhs, rhs };
    }
    return lhs;
  }

  parseComparison(): AstNode {
    let lhs = this.parseAddSub();
    while (true) {
      const t = this.peek();
      if (
        !(
          t?.kind === "op" &&
          (t.value === "<" || t.value === "<=" || t.value === ">" || t.value === ">=")
        )
      )
        break;
      this.advance();
      const rhs = this.parseAddSub();
      lhs = { kind: "binary", op: t.value, lhs, rhs };
    }
    return lhs;
  }

  parseAddSub(): AstNode {
    let lhs = this.parseMulDiv();
    while (true) {
      const t = this.peek();
      if (!(t?.kind === "op" && (t.value === "+" || t.value === "-"))) break;
      this.advance();
      const rhs = this.parseMulDiv();
      lhs = { kind: "binary", op: t.value, lhs, rhs };
    }
    return lhs;
  }

  parseMulDiv(): AstNode {
    let lhs = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (!(t?.kind === "op" && (t.value === "*" || t.value === "/" || t.value === "%")))
        break;
      this.advance();
      const rhs = this.parseUnary();
      lhs = { kind: "binary", op: t.value, lhs, rhs };
    }
    return lhs;
  }

  parseUnary(): AstNode {
    const t = this.peek();
    if (t?.kind === "op" && t.value === "-") {
      this.advance();
      return { kind: "neg", expr: this.parseUnary() };
    }
    if (t?.kind === "op" && t.value === "+") {
      this.advance();
      return this.parseUnary();
    }
    if (t?.kind === "op" && t.value === "!") {
      this.advance();
      return { kind: "not", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary(): AstNode {
    const t = this.advance();
    if (t.kind === "num") return { kind: "num", value: t.value };
    if (t.kind === "lp") {
      const expr = this.parseExpr();
      const close = this.advance();
      if (close.kind !== "rp") throw new Error("expected )");
      return expr;
    }
    if (t.kind === "ident") {
      if (this.peek()?.kind === "lp") {
        this.advance(); // (
        const args: AstNode[] = [];
        if (this.peek()?.kind !== "rp") {
          args.push(this.parseExpr());
          while (this.peek()?.kind === "comma") {
            this.advance();
            args.push(this.parseExpr());
          }
        }
        const close = this.advance();
        if (close.kind !== "rp") throw new Error("expected ) after fn args");
        return { kind: "fn", name: t.value, args };
      }
      return { kind: "var", name: t.value };
    }
    throw new Error(`unexpected token: ${JSON.stringify(t)}`);
  }
}

// ---------- Evaluator ----------

function evaluate(ast: AstNode, ctx: MolangContext): number {
  switch (ast.kind) {
    case "num":
      return ast.value;
    case "neg":
      return -evaluate(ast.expr, ctx);
    case "not":
      return Math.abs(evaluate(ast.expr, ctx)) > 1e-9 ? 0 : 1;
    case "binary":
      return evalBinary(ast.op, ast.lhs, ast.rhs, ctx);
    case "var":
      return resolveVariable(ast.name, ctx);
    case "fn":
      return callFunction(ast.name, ast.args, ctx);
    case "cond":
      return Math.abs(evaluate(ast.cond, ctx)) > 1e-9
        ? evaluate(ast.then, ctx)
        : evaluate(ast.else, ctx);
    case "assign": {
      const v = evaluate(ast.expr, ctx);
      const map = ctx.variables ?? new Map<string, number>();
      map.set(varKey(ast.name), v);
      if (!ctx.variables) ctx.variables = map;
      return v;
    }
    case "seq": {
      let last = 0;
      for (const item of ast.items) {
        if (item.kind === "return") {
          return evaluate(item.expr, ctx);
        }
        last = evaluate(item, ctx);
      }
      return last;
    }
    case "return":
      return evaluate(ast.expr, ctx);
  }
}

function evalBinary(
  op: BinaryOp,
  lhs: AstNode,
  rhs: AstNode,
  ctx: MolangContext
): number {
  // Short-circuit logicals
  if (op === "&&") {
    const a = evaluate(lhs, ctx);
    if (Math.abs(a) <= 1e-9) return 0;
    return Math.abs(evaluate(rhs, ctx)) > 1e-9 ? 1 : 0;
  }
  if (op === "||") {
    const a = evaluate(lhs, ctx);
    if (Math.abs(a) > 1e-9) return 1;
    return Math.abs(evaluate(rhs, ctx)) > 1e-9 ? 1 : 0;
  }
  const a = evaluate(lhs, ctx);
  const b = evaluate(rhs, ctx);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return b === 0 ? 0 : a / b;
    case "%": return b === 0 ? 0 : a - Math.floor(a / b) * b;
    case "<": return a < b ? 1 : 0;
    case "<=": return a <= b ? 1 : 0;
    case ">": return a > b ? 1 : 0;
    case ">=": return a >= b ? 1 : 0;
    case "==": return Math.abs(a - b) < 1e-9 ? 1 : 0;
    case "!=": return Math.abs(a - b) < 1e-9 ? 0 : 1;
  }
  return 0;
}

// ---------- Variables ----------

/**
 * Convert any user-variable identifier to its canonical key in the variables
 * Map. Bedrock treats `variable.x`, `v.x`, and `temp.x` as separate scopes in
 * theory, but in practice authors interchange them — we collapse to one map
 * keyed by the bare name, matching Wintersky/molangjs behaviour.
 */
function varKey(name: string): string {
  if (name.startsWith("variable.")) return name.slice("variable.".length);
  if (name.startsWith("v.")) return name.slice("v.".length);
  if (name.startsWith("temp.")) return name.slice("temp.".length);
  return name;
}

function resolveVariable(name: string, ctx: MolangContext): number {
  switch (name) {
    case "math.pi":
      return Math.PI;

    case "query.anim_time":
    case "q.anim_time":
    case "t.anim_time":
    case "query.time":
    case "q.time":
    case "t.time":
      return ctx.animTime ?? 0;

    case "query.particle_age":
    case "q.particle_age":
      return ctx.particleAge ?? 0;
    case "query.particle_lifetime":
    case "q.particle_lifetime":
      return ctx.particleLifetime ?? 0;
    case "query.particle_speed":
    case "q.particle_speed":
      return ctx.particleSpeed ?? 0;

    case "query.emitter_age":
    case "q.emitter_age":
      return ctx.emitterAge ?? 0;
    case "query.emitter_lifetime":
    case "q.emitter_lifetime":
      return ctx.emitterLifetime ?? 0;
  }

  // particle_random_1..4 / emitter_random_1..4 — accept both `variable.` and `v.` prefixes.
  if (
    name === "variable.particle_random_1" ||
    name === "v.particle_random_1"
  )
    return ctx.particleRandom?.[0] ?? 0;
  if (
    name === "variable.particle_random_2" ||
    name === "v.particle_random_2"
  )
    return ctx.particleRandom?.[1] ?? 0;
  if (
    name === "variable.particle_random_3" ||
    name === "v.particle_random_3"
  )
    return ctx.particleRandom?.[2] ?? 0;
  if (
    name === "variable.particle_random_4" ||
    name === "v.particle_random_4"
  )
    return ctx.particleRandom?.[3] ?? 0;

  if (name === "variable.emitter_random_1" || name === "v.emitter_random_1")
    return ctx.emitterRandom?.[0] ?? 0;
  if (name === "variable.emitter_random_2" || name === "v.emitter_random_2")
    return ctx.emitterRandom?.[1] ?? 0;
  if (name === "variable.emitter_random_3" || name === "v.emitter_random_3")
    return ctx.emitterRandom?.[2] ?? 0;
  if (name === "variable.emitter_random_4" || name === "v.emitter_random_4")
    return ctx.emitterRandom?.[3] ?? 0;

  // Curve lookup: `curves.<name>` evaluates the named curve at its declared input.
  if (name.startsWith("curves.")) {
    const curveName = name.slice("curves.".length);
    const curve = ctx.curves?.[curveName];
    if (!curve) return 0;
    return evaluateCurve(curve, ctx);
  }

  // User-defined `variable.foo` / `v.foo` / `temp.foo` — read from the Map.
  if (
    name.startsWith("variable.") ||
    name.startsWith("v.") ||
    name.startsWith("temp.")
  ) {
    return ctx.variables?.get(varKey(name)) ?? 0;
  }

  return 0;
}

// ---------- Curves ----------

function evaluateCurve(curve: ParticleCurve, ctx: MolangContext): number {
  const input = evalMolang(curve.input, ctx);
  const [hMin, hMax] = curve.horizontalRange ?? curve.range;
  const minH = evalMolang(hMin, ctx);
  const maxH = evalMolang(hMax, ctx);
  const span = maxH - minH;
  if (span <= 0) return curve.nodes[0] ?? 0;
  const t = Math.max(0, Math.min(1, (input - minH) / span));

  const nodes = curve.nodes;
  if (nodes.length === 0) return 0;
  if (nodes.length === 1) return nodes[0];

  if (curve.type === "linear") {
    const last = nodes.length - 1;
    const f = t * last;
    const i = Math.floor(f);
    const u = f - i;
    if (i >= last) return nodes[last];
    return nodes[i] + (nodes[i + 1] - nodes[i]) * u;
  }

  // catmull_rom: smooth interpolation through control points (with virtual end-clamp).
  if (curve.type === "catmull_rom") {
    const last = nodes.length - 1;
    const f = t * last;
    const i = Math.floor(f);
    const u = f - i;
    const p0 = nodes[Math.max(0, i - 1)];
    const p1 = nodes[Math.min(last, i)];
    const p2 = nodes[Math.min(last, i + 1)];
    const p3 = nodes[Math.min(last, i + 2)];
    return catmullRom(p0, p1, p2, p3, u);
  }

  // bezier / bezier_chain: just lerp for now (full bezier sampling is rarely
  // used for particles and not worth the complexity until proven needed).
  const last = nodes.length - 1;
  const f = t * last;
  const i = Math.floor(f);
  const u = f - i;
  if (i >= last) return nodes[last];
  return nodes[i] + (nodes[i + 1] - nodes[i]) * u;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

// ---------- Functions ----------

function callFunction(name: string, args: AstNode[], ctx: MolangContext): number {
  const a = (i: number) => (args[i] ? evaluate(args[i], ctx) : 0);

  switch (name) {
    // 1-arg trig (degrees, per Bedrock spec)
    case "math.sin":
      return Math.sin((a(0) * Math.PI) / 180);
    case "math.cos":
      return Math.cos((a(0) * Math.PI) / 180);
    case "math.abs":
      return Math.abs(a(0));
    case "math.sqrt": {
      const x = a(0);
      return x < 0 ? 0 : Math.sqrt(x);
    }
    case "math.floor":
      return Math.floor(a(0));
    case "math.ceil":
      return Math.ceil(a(0));
    case "math.round":
      return Math.round(a(0));
    case "math.exp":
      return Math.exp(a(0));
    case "math.ln":
      return a(0) > 0 ? Math.log(a(0)) : 0;

    // Inverse trig — Bedrock returns degrees.
    case "math.asin":
      return (Math.asin(Math.max(-1, Math.min(1, a(0)))) * 180) / Math.PI;
    case "math.acos":
      return (Math.acos(Math.max(-1, Math.min(1, a(0)))) * 180) / Math.PI;
    case "math.atan":
      return (Math.atan(a(0)) * 180) / Math.PI;
    case "math.atan2":
      return (Math.atan2(a(0), a(1)) * 180) / Math.PI;

    // Multi-arg
    case "math.pow":
      return Math.pow(a(0), a(1));
    case "math.mod": {
      const y = a(1);
      return y === 0 ? 0 : a(0) - Math.floor(a(0) / y) * y;
    }
    case "math.max":
      return Math.max(a(0), a(1));
    case "math.min":
      return Math.min(a(0), a(1));
    case "math.clamp":
      return Math.max(a(1), Math.min(a(2), a(0)));
    case "math.lerp":
      return a(0) + (a(1) - a(0)) * a(2);
    case "math.lerprotate": {
      const from = a(0);
      const to = a(1);
      const t = a(2);
      let diff = ((to - from) % 360 + 540) % 360 - 180;
      return from + diff * t;
    }
    case "math.hermite_blend": {
      const t = a(0);
      return 3 * t * t - 2 * t * t * t;
    }

    // Random (uniform). Bedrock spec: math.random(low, high) — float in [low, high).
    case "math.random": {
      const low = a(0);
      const high = a(1);
      if (high <= low) return low;
      return low + Math.random() * (high - low);
    }
    case "math.random_integer": {
      const low = Math.floor(a(0));
      const high = Math.floor(a(1));
      if (high <= low) return low;
      return low + Math.floor(Math.random() * (high - low + 1));
    }

    // Die roll (sum of N uniform rolls).
    case "math.die_roll": {
      const num = Math.max(0, Math.floor(a(0)));
      const low = a(1);
      const high = a(2);
      let sum = 0;
      for (let i = 0; i < num; i++) sum += low + Math.random() * (high - low);
      return sum;
    }
    case "math.die_roll_integer": {
      const num = Math.max(0, Math.floor(a(0)));
      const low = Math.floor(a(1));
      const high = Math.floor(a(2));
      let sum = 0;
      for (let i = 0; i < num; i++) {
        sum += low + Math.floor(Math.random() * (high - low + 1));
      }
      return sum;
    }
  }
  return 0;
}
