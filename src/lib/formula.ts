// Minimal formula engine: tokenizer + recursive-descent parser + evaluator.
// Supports arithmetic, comparisons, IF/AND/OR/NOT, text and date helpers.
// Field references use {Field Name} syntax and are resolved against a
// name->value map built fresh from the record's current data on every
// evaluation, so results always reflect the latest dependent field values.

type Value = string | number | boolean | null;

type TokenType = "num" | "str" | "ident" | "field" | "op" | "lparen" | "rparen" | "comma" | "eof";
interface Token {
  type: TokenType;
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) throw new Error("Unterminated field reference");
      tokens.push({ type: "field", value: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== quote) {
        out += src[j];
        j++;
      }
      tokens.push({ type: "str", value: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: "num", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", value: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma", value: c });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%><=".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${c}' in formula`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "field"; name: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "bin"; op: string; left: Node; right: Node }
  | { kind: "unary"; op: string; expr: Node };

class Parser {
  pos = 0;
  constructor(private tokens: Token[]) {}
  peek() {
    return this.tokens[this.pos];
  }
  next() {
    return this.tokens[this.pos++];
  }
  expect(type: TokenType) {
    const t = this.next();
    if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type}`);
    return t;
  }

  parseExpression(): Node {
    return this.parseOr();
  }
  parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek().type === "op" && this.peek().value === "||") {
      this.next();
      left = { kind: "bin", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }
  parseAnd(): Node {
    let left = this.parseComparison();
    while (this.peek().type === "op" && this.peek().value === "&&") {
      this.next();
      left = { kind: "bin", op: "&&", left, right: this.parseComparison() };
    }
    return left;
  }
  parseComparison(): Node {
    let left = this.parseAdditive();
    while (this.peek().type === "op" && ["==", "!=", ">", ">=", "<", "<="].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "bin", op, left, right: this.parseAdditive() };
    }
    return left;
  }
  parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && ["+", "-"].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "bin", op, left, right: this.parseMultiplicative() };
    }
    return left;
  }
  parseMultiplicative(): Node {
    let left = this.parseUnary();
    while (this.peek().type === "op" && ["*", "/", "%"].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "bin", op, left, right: this.parseUnary() };
    }
    return left;
  }
  parseUnary(): Node {
    if (this.peek().type === "op" && this.peek().value === "-") {
      this.next();
      return { kind: "unary", op: "-", expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  parsePrimary(): Node {
    const t = this.peek();
    if (t.type === "num") {
      this.next();
      return { kind: "num", value: parseFloat(t.value) };
    }
    if (t.type === "str") {
      this.next();
      return { kind: "str", value: t.value };
    }
    if (t.type === "field") {
      this.next();
      return { kind: "field", name: t.value };
    }
    if (t.type === "lparen") {
      this.next();
      const expr = this.parseExpression();
      this.expect("rparen");
      return expr;
    }
    if (t.type === "ident") {
      this.next();
      if (this.peek().type === "lparen") {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseExpression());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseExpression());
          }
        }
        this.expect("rparen");
        return { kind: "call", name: t.value.toUpperCase(), args };
      }
      if (t.value.toUpperCase() === "TRUE") return { kind: "num", value: 1 };
      if (t.value.toUpperCase() === "FALSE") return { kind: "num", value: 0 };
      return { kind: "call", name: t.value.toUpperCase(), args: [] };
    }
    throw new Error(`Unexpected token ${t.type}`);
  }
}

function toNum(v: Value): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}
function toStr(v: Value): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
function toBool(v: Value): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0 && v !== "0";
  return false;
}

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function evaluate(node: Node, fields: Record<string, Value>): Value {
  switch (node.kind) {
    case "num":
      return node.value;
    case "str":
      return node.value;
    case "field":
      return fields[node.name] ?? null;
    case "unary": {
      const v = evaluate(node.expr, fields);
      return -toNum(v);
    }
    case "bin": {
      const l = evaluate(node.left, fields);
      const r = evaluate(node.right, fields);
      switch (node.op) {
        case "+":
          return typeof l === "string" || typeof r === "string" ? toStr(l) + toStr(r) : toNum(l) + toNum(r);
        case "-":
          return toNum(l) - toNum(r);
        case "*":
          return toNum(l) * toNum(r);
        case "/":
          return toNum(r) === 0 ? 0 : toNum(l) / toNum(r);
        case "%":
          return toNum(r) === 0 ? 0 : toNum(l) % toNum(r);
        case "==":
          return toStr(l) === toStr(r);
        case "!=":
          return toStr(l) !== toStr(r);
        case ">":
          return toNum(l) > toNum(r);
        case ">=":
          return toNum(l) >= toNum(r);
        case "<":
          return toNum(l) < toNum(r);
        case "<=":
          return toNum(l) <= toNum(r);
        case "&&":
          return toBool(l) && toBool(r);
        case "||":
          return toBool(l) || toBool(r);
        default:
          return null;
      }
    }
    case "call": {
      const args = node.args.map((a) => evaluate(a, fields));
      switch (node.name) {
        case "IF":
          return toBool(args[0]) ? args[1] ?? null : args[2] ?? null;
        case "AND":
          return args.every(toBool);
        case "OR":
          return args.some(toBool);
        case "NOT":
          return !toBool(args[0]);
        case "CONCAT":
          return args.map(toStr).join("");
        case "LEFT":
          return toStr(args[0]).slice(0, toNum(args[1]));
        case "RIGHT":
          return toStr(args[0]).slice(-toNum(args[1]));
        case "MID":
          return toStr(args[0]).slice(toNum(args[1]) - 1, toNum(args[1]) - 1 + toNum(args[2]));
        case "LEN":
          return toStr(args[0]).length;
        case "UPPER":
          return toStr(args[0]).toUpperCase();
        case "LOWER":
          return toStr(args[0]).toLowerCase();
        case "TODAY":
          return new Date().toISOString().slice(0, 10);
        case "NOW":
          return new Date().toISOString();
        case "YEAR":
          return new Date(toStr(args[0])).getFullYear();
        case "MONTH":
          return new Date(toStr(args[0])).getMonth() + 1;
        case "DAY":
          return new Date(toStr(args[0])).getDate();
        case "DATE_DIFF":
          return daysBetween(new Date(toStr(args[0])), new Date(toStr(args[1])));
        case "SUM":
          return args.reduce((s: number, v) => s + toNum(v), 0);
        case "AVG":
          return args.length ? args.reduce((s: number, v) => s + toNum(v), 0) / args.length : 0;
        case "MIN":
          return Math.min(...args.map(toNum));
        case "MAX":
          return Math.max(...args.map(toNum));
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

export function evaluateFormula(expression: string, fields: Record<string, Value>): Value {
  try {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    const ast = parser.parseExpression();
    return evaluate(ast, fields);
  } catch {
    return "#ERROR";
  }
}
