/**
 * hyper-morph-json-parse.js — the two JSON dialects mergeable script tags
 * speak. Pure functions, no DOM access, no dependencies, and never eval:
 * both parsers emit strict JSON text and hand it to JSON.parse.
 *
 * parseJsonRelaxed — the default dialect for merge tags. Strict JSON plus
 * the ergonomics people actually use in hand-written data tags: unquoted
 * identifier keys, single-quoted strings, trailing commas, and comments.
 * Values must still be real JSON literals or quoted strings; barewords
 * never silently become strings, so typos and truncated streams fail parse
 * and hit the merge's safe degradation instead of merging garbage.
 *
 * parseRulesRelaxed — the hypercms / hyper-html-api rules-tag dialect,
 * ported verbatim from hyper-html-api's parseRelaxed (which itself ports
 * the legacy ?data= URL parser) so rules tags merge exactly as they load.
 * Its defining quirk: unquoted selector-flavored barewords become strings
 * (`{Title: #hero .qt}`), and `[foo]` is an attribute selector, not an
 * array. hyper-morph is the canonical home of this dialect going forward.
 */

/**
 * Return the index of the next meaningful character at or after `i`:
 * skips whitespace, `//` line comments, and slash-star block comments.
 * An unterminated block comment skips to end of input; the truncated
 * output then fails JSON.parse, which is the error we want anyway.
 * @param {string} input
 * @param {number} i
 * @returns {number}
 */
function nextMeaningful(input, i) {
  for (;;) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (input[i] === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    if (input[i] === "/" && input[i + 1] === "*") {
      const end = input.indexOf("*/", i + 2);
      if (end === -1) return input.length;
      i = end + 2;
      continue;
    }
    return i;
  }
}

/**
 * Re-emit a single-quoted string body as a double-quoted JSON string body:
 * \' was escaping the outer quote in the source, and any unescaped " needs
 * escaping ("unescaped" = preceded by an even number of backslashes).
 * @param {string} value
 * @returns {string}
 */
function singleToDoubleQuoted(value) {
  return value
    .replace(/\\'/g, "'")
    .replace(/(\\*)"/g, (m, slashes) =>
      slashes.length % 2 === 0 ? slashes + '\\"' : m,
    );
}

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Conservative relaxed-JSON parser: strict JSON first, then a tolerant
 * pass allowing unquoted identifier keys, single-quoted strings, trailing
 * commas, and comments. Throws on anything else — values must be JSON
 * literals or quoted strings.
 * @param {string} text
 * @returns {any}
 */
function parseJsonRelaxed(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return JSON.parse(relaxedToStrictJson(text));
  }
}

/**
 * @param {string} input
 * @returns {string} strict JSON text
 */
function relaxedToStrictJson(input) {
  let out = "";
  let i = 0;

  /**
   * @param {string} msg
   * @param {number} at
   * @returns {never}
   */
  const fail = (msg, at) => {
    throw new Error(`Invalid relaxed JSON: ${msg} at position ${at}`);
  };

  while (i < input.length) {
    i = nextMeaningful(input, i);
    if (i >= input.length) break;
    const char = input[i];

    if ("{}[]:".includes(char)) {
      out += char;
      i++;
      continue;
    }

    if (char === ",") {
      const next = nextMeaningful(input, i + 1);
      if (input[next] === "}" || input[next] === "]") {
        i++; // trailing comma: dropped
        continue;
      }
      out += char;
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== char) {
        if (input[j] === "\\") j++;
        j++;
      }
      if (j >= input.length) fail("unterminated string", i);
      let value = input.slice(i + 1, j);
      if (char === "'") value = singleToDoubleQuoted(value);
      out += '"' + value + '"';
      i = j + 1;
      continue;
    }

    let j = i;
    while (j < input.length && /[A-Za-z0-9_$.+\-]/.test(input[j])) j++;
    if (j === i) fail("unexpected character " + JSON.stringify(char), i);
    const word = input.slice(i, j);

    if (
      word === "true" ||
      word === "false" ||
      word === "null" ||
      JSON_NUMBER.test(word)
    ) {
      out += word;
      i = j;
      continue;
    }

    if (IDENTIFIER.test(word)) {
      // An identifier is only legal as an object key.
      if (input[nextMeaningful(input, j)] === ":") {
        out += '"' + word + '"';
        i = j;
        continue;
      }
      fail("unquoted value " + JSON.stringify(word), i);
    }

    fail("invalid token " + JSON.stringify(word), i);
  }

  return out;
}

/**
 * The rules-tag dialect (hypercms / hyper-html-api `data-rules-name`
 * script tags and the legacy ?data= URL parameter). Ported verbatim from
 * hyper-html-api/src/engine/rules.js parseRelaxed, minus its unreachable
 * emit fallback (every token type the tokenizer produces is handled), so
 * existing rules tags merge exactly as they parse when loading.
 * @param {string} queryString
 * @returns {any}
 */
function parseRulesRelaxed(queryString) {
  try {
    return JSON.parse(queryString);
  } catch (_) {
    /* fall through to tokenizer */
  }

  const TokenType = {
    BRACE_OPEN: "{",
    BRACE_CLOSE: "}",
    BRACKET_OPEN: "[",
    BRACKET_CLOSE: "]",
    COLON: ":",
    COMMA: ",",
    STRING: "STRING",
    SELECTOR: "SELECTOR",
    IDENTIFIER: "IDENTIFIER",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
  };

  /**
   * @param {string} input
   * @returns {{type: string, value: string, quoted?: boolean, sourceQuote?: string}[]}
   */
  function tokenize(input) {
    const tokens = [];
    let i = 0;

    while (i < input.length) {
      const char = input[i];

      if (/\s/.test(char)) {
        i++;
        continue;
      }

      if ("{}".includes(char)) {
        tokens.push({ type: char, value: char });
        i++;
        continue;
      }

      if (char === "[") {
        let isAttributeSelector = false;
        let j = i + 1;

        while (j < input.length && /\s/.test(input[j])) j++;

        if (j < input.length && /[a-zA-Z_]/.test(input[j])) {
          isAttributeSelector = true;
        }

        if (!isAttributeSelector) {
          tokens.push({ type: char, value: char });
          i++;
          continue;
        }
      }

      if (char === "]") {
        tokens.push({ type: char, value: char });
        i++;
        continue;
      }

      if (char === ":") {
        tokens.push({ type: TokenType.COLON, value: char });
        i++;
        continue;
      }

      if (char === ",") {
        tokens.push({ type: TokenType.COMMA, value: char });
        i++;
        continue;
      }

      if (char === '"' || char === "'") {
        const quote = char;
        let j = i + 1;
        while (j < input.length && input[j] !== quote) {
          if (input[j] === "\\") j++;
          j++;
        }
        tokens.push({
          type: TokenType.STRING,
          value: input.substring(i + 1, j),
          quoted: true,
          sourceQuote: quote,
        });
        i = j + 1;
        continue;
      }

      let j = i;
      let value;

      while (j < input.length && !/[{},]/.test(input[j])) {
        if (input[j] === ":") {
          const pseudoSelectors = [
            ":first",
            ":last",
            ":nth-child",
            ":nth-of-type",
            ":first-child",
            ":last-child",
            ":first-of-type",
            ":last-of-type",
            ":only-child",
            ":only-of-type",
            ":hover",
            ":focus",
            ":active",
            ":visited",
            ":disabled",
            ":enabled",
            ":checked",
            ":empty",
            ":root",
            ":target",
            ":not",
            ":before",
            ":after",
            ":nth-last-child",
            ":nth-last-of-type",
          ];

          let isPseudoSelector = false;
          for (const pseudo of pseudoSelectors) {
            const pseudoName = pseudo.substring(1);
            const afterColon = input.substring(
              j + 1,
              j + 1 + pseudoName.length,
            );
            if (afterColon === pseudoName) {
              isPseudoSelector = true;
              j += pseudoName.length;
              break;
            }
          }

          if (!isPseudoSelector) break;
        } else if (input[j] === "[") {
          j++;
          while (j < input.length && input[j] !== "]") {
            if (input[j] === '"' || input[j] === "'") {
              const quote = input[j];
              j++;
              while (j < input.length && input[j] !== quote) {
                if (input[j] === "\\") j++;
                j++;
              }
            }
            j++;
          }
          if (j < input.length && input[j] === "]") j++;
        } else {
          j++;
        }
      }
      value = input.substring(i, j);

      let type = TokenType.IDENTIFIER;

      if (/^-?\d+(\.\d+)?$/.test(value)) {
        type = TokenType.NUMBER;
      } else if (value === "true" || value === "false" || value === "null") {
        type = TokenType.BOOLEAN;
      } else if (/^[.#@\[]|[.#@\[]| /.test(value)) {
        type = TokenType.SELECTOR;
      }

      tokens.push({ type, value, quoted: false });
      i = j;
    }

    return tokens;
  }

  /**
   * @param {ReturnType<typeof tokenize>} tokens
   * @returns {string}
   */
  function tokensToJSON(tokens) {
    let result = "";

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if ("{}".includes(token.type) || "[]".includes(token.type)) {
        result += token.value;
        continue;
      }

      if (token.type === TokenType.COLON) {
        result += token.value;
        continue;
      }

      if (token.type === TokenType.COMMA) {
        // Drop trailing commas. JSON.parse rejects them; relaxed authors
        // expect them to work.
        const next = tokens[i + 1];
        if (next && (next.type === "}" || next.type === "]")) {
          continue;
        }
        result += token.value;
        continue;
      }

      if (token.type === TokenType.STRING) {
        let v = token.value;
        if (token.sourceQuote === "'") {
          v = singleToDoubleQuoted(v);
        }
        result += `"${v}"`;
        continue;
      }

      if (token.type === TokenType.NUMBER || token.type === TokenType.BOOLEAN) {
        result += token.value;
        continue;
      }

      // TokenType.SELECTOR / TokenType.IDENTIFIER — the only types left.
      result += `"${token.value}"`;
    }

    return result;
  }

  try {
    const tokens = tokenize(queryString);
    const jsonString = tokensToJSON(tokens);
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error(
      "Invalid extraction rules syntax: " +
        /** @type {Error} */ (error).message,
    );
  }
}

export { parseJsonRelaxed, parseRulesRelaxed };
