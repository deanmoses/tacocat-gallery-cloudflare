// The search syntax is RediSearch's: words anywhere, "an exact phrase", pre* for a prefix, -not this, this|that,
// @title:word or @title|tags:(some words) to look in a field, and parentheses to group. It compiles to a tree of FTS5
// matches, so that a searcher's typing is never a syntax error to SQLite: anything that is not part of the syntax
// above is a word or a space.

/** RediSearch's default stop words, so 'felix at the beach' asks for two words. */
const STOP_WORDS = new Set([
    'a',
    'is',
    'the',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'for',
    'if',
    'in',
    'into',
    'it',
    'no',
    'not',
    'of',
    'on',
    'or',
    'such',
    'that',
    'their',
    'then',
    'there',
    'these',
    'they',
    'this',
    'to',
    'was',
    'will',
    'with',
]);

// The columns of the indexes.
const FIELDS = ['name', 'title', 'description', 'tags', 'summary'] as const;
type Field = (typeof FIELDS)[number];

// Below this a prefix expands to too much of the vocabulary to mean anything, so the star is ignored.
const MIN_PREFIX = 2;
// Each word or phrase becomes a bound parameter of the two statements a search runs, and D1 allows a hundred each.
const MAX_TERMS = 32;
// Each level of parentheses nests the SQL and the compiler's own recursion one deeper.
const MAX_DEPTH = 8;

const EMPTY = 'No search terms supplied';
const ONLY_NEGATIVE = 'A search needs a word to look for, not only words to leave out';
const TOO_MANY = `A search can have at most ${MAX_TERMS} words and phrases`;
const TOO_DEEP = `A search can nest parentheses at most ${MAX_DEPTH} deep`;

/**
 * What to match: one FTS5 expression against one of the indexes, or a combination. Terms of one index are combined
 * inside its expression, where FTS5 intersects a rare word with a common one by reading the rare one; only terms of
 * different indexes are combined outside it.
 */
export type Query = Match | { all: Query[]; not: Query[] } | { any: Query[] };

export interface Match {
    index: 'stemmed' | 'exact';
    match: string;
}

const INDEXES = ['stemmed', 'exact'] as const;

/** The error is in words for the searcher. */
export type FtsQuery = { query: Query } | { error: string };

export function ftsQuery(terms: string): FtsQuery {
    const tokens = tokenize(terms);
    if ('error' in tokens) return tokens;
    const parsed = parse(tokens);
    if ('error' in parsed) return parsed;
    const top = emitAlternatives(parsed, null);
    if ('error' in top) return top;
    if (top.all.length === 0) return { error: top.not.length === 0 ? EMPTY : ONLY_NEGATIVE };
    return { query: fold(toQuery(top)) };
}

type Token =
    | { kind: 'phrase'; words: string[] }
    | { kind: 'word'; words: string[]; prefix: boolean }
    | { kind: 'not' }
    | { kind: 'field'; fields: Field[] }
    | { kind: 'open' }
    | { kind: 'close' }
    | { kind: 'or' };

const SPACE = /\s+/vy;
const QUOTE = /["“”]/vy;
const CLOSING_QUOTE = /["“”]/gv;
const SYNTAX = /[\(\)\|]/vy;
const SYNTAX_KINDS: Record<string, 'open' | 'close' | 'or'> = { '(': 'open', ')': 'close', '|': 'or' };
// A minus is negation at the start of a term, or right after a field; inside a word, as in 'felix-beach', it is a
// separator.
const NEGATION = /(?<=^|[\s\(\|])-(?=[\p{L}\p{N}"\(@“])/vy;
const NEGATION_AFTER_FIELD = /-(?=[\p{L}\p{N}"\(@“])/vy;
const FIELD = /@(?<names>\p{L}+(?:\|\p{L}+)*):/vy;
const WORD = /[\p{L}\p{N}]+\*?/vy;
const WORDS = /[\p{L}\p{N}]+/gv;
// The index puts a space wherever a letter meets a digit, so 'pat1' is the two words 'pat 1' on both sides.
const LETTER_DIGIT_BOUNDARY = /(?<=\D)(?=\d)|(?<=\d)(?=\D)/v;

function tokenize(terms: string): Token[] | { error: string } {
    const tokens: Token[] = [];
    let at = 0;
    const take = (pattern: RegExp): RegExpExecArray | null => {
        pattern.lastIndex = at;
        const found = pattern.exec(terms);
        if (found !== null) at = pattern.lastIndex;
        return found;
    };
    while (at < terms.length) {
        if (take(SPACE) !== null) continue;
        if (take(QUOTE) !== null) {
            CLOSING_QUOTE.lastIndex = at;
            const closing = CLOSING_QUOTE.exec(terms);
            const words = wordsOf(terms.slice(at, closing?.index ?? terms.length));
            at = closing === null ? terms.length : CLOSING_QUOTE.lastIndex;
            if (words.length > 0) tokens.push({ kind: 'phrase', words });
            continue;
        }
        const syntax = take(SYNTAX);
        if (syntax !== null) {
            tokens.push({ kind: SYNTAX_KINDS[syntax[0]] ?? 'or' });
            continue;
        }
        if ((take(NEGATION) ?? (tokens.at(-1)?.kind === 'field' ? take(NEGATION_AFTER_FIELD) : null)) !== null) {
            tokens.push({ kind: 'not' });
            continue;
        }
        const field = take(FIELD);
        if (field !== null) {
            const fields = fieldsNamed(field.groups?.['names'] ?? '');
            if ('error' in fields) return fields;
            tokens.push({ kind: 'field', fields });
            continue;
        }
        const word = take(WORD);
        if (word !== null) {
            const text = word[0].endsWith('*') ? word[0].slice(0, -1) : word[0];
            const prefix = text.length < word[0].length && text.length >= MIN_PREFIX;
            tokens.push({ kind: 'word', words: wordsOf(text), prefix });
            continue;
        }
        at += 1;
    }
    return tokens;
}

function wordsOf(text: string): string[] {
    return (text.match(WORDS) ?? []).flatMap((word) => word.split(LETTER_DIGIT_BOUNDARY));
}

function fieldsNamed(names: string): Field[] | { error: string } {
    const fields: Field[] = [];
    for (const name of names.split('|')) {
        const field = FIELDS.find((known) => known === name.toLowerCase());
        if (field === undefined) {
            return { error: `No search field named [${name}]; the fields are ${FIELDS.join(', ')}` };
        }
        fields.push(field);
    }
    return fields;
}

interface Term {
    negated: boolean;
    fields: Field[] | null;
    node: Node;
}

/** A group is alternatives, each of which is everything in it. */
type Node = { words: string[]; prefix: boolean } | { alternatives: Term[][] };

interface Cursor {
    tokens: Token[];
    at: number;
    /** Words and phrases so far, each of which becomes a bound parameter; stop words and empty quotes do not count. */
    terms: number;
}

function parse(tokens: Token[]): Term[][] | { error: string } {
    const alternatives: Term[][] = [[]];
    const cursor: Cursor = { tokens, at: 0, terms: 0 };
    while (cursor.at < tokens.length) {
        const problem = parseInto(alternatives, cursor, 0);
        if (problem !== undefined) return problem;
        // A closing parenthesis with nothing open before it is skipped.
        cursor.at += 1;
    }
    return cursor.terms > MAX_TERMS ? { error: TOO_MANY } : alternatives;
}

/** Reads terms into `alternatives` up to a closing parenthesis, which is left for the caller, or the end. */
function parseInto(alternatives: Term[][], cursor: Cursor, depth: number): { error: string } | undefined {
    let negated = false;
    let fields: Field[] | null = null;
    const add = (node: Node): void => {
        alternatives.at(-1)?.push({ negated, fields, node });
        if ('words' in node) cursor.terms += 1;
        negated = false;
        fields = null;
    };
    for (; cursor.at < cursor.tokens.length; cursor.at += 1) {
        const token = cursor.tokens[cursor.at];
        if (token === undefined || token.kind === 'close') return undefined;
        switch (token.kind) {
            case 'or':
                alternatives.push([]);
                break;
            case 'not':
                negated = true;
                break;
            case 'field':
                fields = token.fields;
                break;
            case 'open': {
                if (depth === MAX_DEPTH) return { error: TOO_DEEP };
                const inner: Term[][] = [[]];
                cursor.at += 1;
                const problem = parseInto(inner, cursor, depth + 1);
                if (problem !== undefined) return problem;
                add({ alternatives: inner });
                break;
            }
            case 'phrase':
                add({ words: token.words, prefix: false });
                break;
            case 'word':
                if (token.words.length === 1 && !token.prefix && STOP_WORDS.has(token.words[0]?.toLowerCase() ?? '')) {
                    negated = false;
                    fields = null;
                } else {
                    add({ words: token.words, prefix: token.prefix });
                }
                break;
        }
    }
    return undefined;
}

// A group in the making: what must match and what must not. A group with nothing in it is what a stop word or an
// empty pair of quotes leaves behind, and the group around it drops it. A group that is not negated is merged into the
// group around it, since every term of both must match anyway, which is how 'felix (-milo)' leaves out milo.

interface Group {
    all: Query[];
    not: Query[];
}

function toQuery(group: Group): Query {
    const [only] = group.all;
    return only !== undefined && group.all.length === 1 && group.not.length === 0 ? only : group;
}

function emitAlternatives(alternatives: Term[][], fields: Field[] | null): Group | { error: string } {
    const groups: Group[] = [];
    for (const terms of alternatives) {
        const group = emitGroup(terms, fields);
        if ('error' in group) return group;
        if (group.all.length > 0 || group.not.length > 0) groups.push(group);
    }
    const [only] = groups;
    if (only !== undefined && groups.length === 1) return only;
    if (groups.some((group) => group.all.length === 0)) return { error: ONLY_NEGATIVE };
    return { all: groups.length === 0 ? [] : [{ any: groups.map(toQuery) }], not: [] };
}

function emitGroup(terms: Term[], fields: Field[] | null): Group | { error: string } {
    const group: Group = { all: [], not: [] };
    for (const term of terms) {
        const inner = emitTerm(term, term.fields ?? fields);
        if ('error' in inner) return inner;
        if (!term.negated) {
            group.all.push(...inner.all);
            group.not.push(...inner.not);
        } else if (inner.all.length > 0) {
            group.not.push(toQuery(inner));
        } else if (inner.not.length > 0) {
            return { error: ONLY_NEGATIVE };
        }
    }
    return group;
}

/** Combines what can be combined inside one index's expression, leaving to SQL only what spans the two. */
function fold(query: Query): Query {
    if ('match' in query) return query;
    if ('any' in query) {
        const parts = query.any.map(fold);
        const [first] = parts;
        if (first === undefined || !('match' in first)) return { any: parts };
        return parts.every((part): part is Match => sameIndex(part, first))
            ? { index: first.index, match: parts.map(operand).join(' OR ') }
            : { any: parts };
    }
    const positives = query.all.map(fold);
    const negatives = query.not.map(fold);
    const all = positives.filter((part) => !('match' in part));
    const not = negatives.filter((part) => !('match' in part));
    for (const index of INDEXES) {
        const matched = positives.filter((part): part is Match => 'match' in part && part.index === index);
        const excluded = negatives.filter((part): part is Match => 'match' in part && part.index === index);
        const [only] = matched;
        if (only === undefined) {
            not.push(...excluded);
            continue;
        }
        const match = matched.length === 1 ? only.match : matched.map(operand).join(' AND ');
        all.push({
            index,
            match: excluded.length === 0 ? match : `(${match}) NOT (${excluded.map(operand).join(' OR ')})`,
        });
    }
    return toQuery({ all, not });
}

function operand(match: Match): string {
    return `(${match.match})`;
}

function sameIndex(part: Query, first: Query): part is Match {
    return 'match' in part && 'match' in first && part.index === first.index;
}

function emitTerm(term: Term, fields: Field[] | null): Group | { error: string } {
    if ('alternatives' in term.node) return emitAlternatives(term.node.alternatives, fields);
    // The stemmer stems a prefix too, and 'vacati' stemmed is no prefix of 'vacat', the stem of 'vacation'.
    const phrase = `"${term.node.words.join(' ')}"${term.node.prefix ? '*' : ''}`;
    const column = fields === null ? '' : `${fields.length === 1 ? fields.join('') : `{${fields.join(' ')}}`}:`;
    return { all: [{ index: term.node.prefix ? 'exact' : 'stemmed', match: `${column}${phrase}` }], not: [] };
}
