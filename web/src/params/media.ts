export function match(param: string): boolean {
    return /^[^.]+\.[^.]+$/v.test(param);
}
