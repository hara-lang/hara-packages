export class EdnDataError extends Error {
  constructor(message, position = null) {
    super(position == null ? message : `${message} at character ${position}`);
    this.name = "EdnDataError";
    this.position = position;
  }
}

export class EdnKeyword {
  constructor(name) {
    this.name = String(name).replace(/^:/, "");
    Object.freeze(this);
  }

  toString() {
    return `:${this.name}`;
  }
}

const DEFAULT_LIMITS = Object.freeze({
  sourceLength: 1_000_000,
  tokens: 50_000,
  depth: 32,
  entries: 20_000,
  stringLength: 200_000,
});

const DELIMITERS = new Set(["(", ")", "[", "]", "{", "}"]);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function limits(options = {}) {
  return {
    ...DEFAULT_LIMITS,
    ...(options.limits || {}),
  };
}

function readString(source, start, settings) {
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const character = source[index];
    if (character === '"') return { value, next: index + 1 };
    if (character === "\\") {
      index += 1;
      if (index >= source.length) throw new EdnDataError("Unterminated string escape", start);
      const escaped = source[index];
      const escapes = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        '"': '"',
        "\\": "\\",
      };
      if (escaped === "u") {
        const code = source.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(code)) {
          throw new EdnDataError("Invalid Unicode string escape", index - 1);
        }
        value += String.fromCharCode(Number.parseInt(code, 16));
        index += 5;
      } else {
        if (!Object.hasOwn(escapes, escaped)) {
          throw new EdnDataError(`Unsupported string escape \\${escaped}`, index - 1);
        }
        value += escapes[escaped];
        index += 1;
      }
    } else {
      if (character.charCodeAt(0) < 0x20 && character !== "\n" && character !== "\r" && character !== "\t") {
        throw new EdnDataError("Control characters must be escaped in strings", index);
      }
      value += character;
      index += 1;
    }
    if (value.length > settings.stringLength) {
      throw new EdnDataError("EDN string exceeds the length limit", start);
    }
  }
  throw new EdnDataError("Unterminated string", start);
}

export function tokenizeEdn(source, options = {}) {
  if (typeof source !== "string") throw new TypeError("EDN source must be a string");
  const settings = limits(options);
  if (source.length > settings.sourceLength) {
    throw new EdnDataError("EDN source exceeds the size limit");
  }

  const tokens = [];
  let index = 0;
  const push = (token) => {
    tokens.push(token);
    if (tokens.length > settings.tokens) throw new EdnDataError("EDN source exceeds the token limit", token.position);
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s|,/.test(character)) {
      index += 1;
      continue;
    }
    if (character === ";") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (DELIMITERS.has(character)) {
      push({ type: "delimiter", value: character, position: index });
      index += 1;
      continue;
    }
    if (character === "'") {
      push({ type: "quote", value: character, position: index });
      index += 1;
      continue;
    }
    if (character === '"') {
      const result = readString(source, index, settings);
      push({ type: "string", value: result.value, position: index });
      index = result.next;
      continue;
    }

    const position = index;
    let value = "";
    while (
      index < source.length
      && !/\s|,/.test(source[index])
      && !DELIMITERS.has(source[index])
      && source[index] !== ";"
      && source[index] !== "'"
      && source[index] !== '"'
    ) {
      value += source[index];
      index += 1;
    }
    if (!value) throw new EdnDataError(`Unexpected character ${source[index]}`, index);
    push({ type: "atom", value, position });
  }
  return tokens;
}

function atomValue(token) {
  if (token.type === "string") return token.value;
  const value = token.value;
  if (value === "nil") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (NUMBER.test(value)) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new EdnDataError("EDN numbers must be finite", token.position);
    return number;
  }
  if (value.startsWith(":")) {
    const name = value.slice(1);
    if (!name || name === ":" || /\s/.test(name)) throw new EdnDataError("Invalid EDN keyword", token.position);
    return new EdnKeyword(name);
  }
  throw new EdnDataError(`Symbols are not allowed in registry data: ${value}`, token.position);
}

function mapKey(value, position) {
  if (value instanceof EdnKeyword) return value.name;
  if (typeof value === "string" && value) return value;
  throw new EdnDataError("EDN map keys must be keywords or non-empty strings", position);
}

export function readEdnData(source, options = {}) {
  const settings = limits(options);
  const tokens = tokenizeEdn(source, { limits: settings });
  let cursor = 0;
  let entries = 0;

  const spend = (count, position) => {
    entries += count;
    if (entries > settings.entries) throw new EdnDataError("EDN value exceeds the entry limit", position);
  };

  function readForm(depth = 0) {
    if (depth > settings.depth) throw new EdnDataError("EDN value exceeds the depth limit", tokens[cursor]?.position ?? source.length);
    const token = tokens[cursor];
    if (!token) throw new EdnDataError("Unexpected end of EDN input", source.length);
    cursor += 1;

    if (token.type === "quote") throw new EdnDataError("Quoted forms are not allowed in registry data", token.position);
    if (token.type !== "delimiter") return atomValue(token);

    if (token.value === "(") throw new EdnDataError("Lists are not allowed in registry data", token.position);
    if (token.value === ")" || token.value === "]" || token.value === "}") {
      throw new EdnDataError(`Unexpected '${token.value}'`, token.position);
    }

    const close = token.value === "[" ? "]" : "}";
    const values = [];
    while (cursor < tokens.length && tokens[cursor].value !== close) values.push(readForm(depth + 1));
    if (cursor >= tokens.length) throw new EdnDataError(`Expected '${close}'`, token.position);
    cursor += 1;

    if (token.value === "[") {
      spend(values.length, token.position);
      return values;
    }
    if (values.length % 2 !== 0) throw new EdnDataError("Map literal requires an even number of forms", token.position);
    spend(values.length / 2, token.position);
    const output = Object.create(null);
    for (let index = 0; index < values.length; index += 2) {
      const key = mapKey(values[index], token.position);
      if (Object.hasOwn(output, key)) throw new EdnDataError(`Duplicate EDN map key: ${key}`, token.position);
      output[key] = values[index + 1];
    }
    return output;
  }

  if (!tokens.length) throw new EdnDataError("EDN source must contain one data value", 0);
  const value = readForm();
  if (cursor !== tokens.length) throw new EdnDataError("EDN source must contain exactly one data value", tokens[cursor].position);
  return value;
}

export function keywordName(value) {
  return value instanceof EdnKeyword ? value.name : null;
}
