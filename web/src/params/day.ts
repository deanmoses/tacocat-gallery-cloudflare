export function match(param: string): boolean {
    return /^\d{2}-\d{2}$/v.test(param);
}
