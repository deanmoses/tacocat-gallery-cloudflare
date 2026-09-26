export function match(param: string): boolean {
    return /^[^.]+\.[^.]+$/u.test(param);
}
