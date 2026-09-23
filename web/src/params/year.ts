export function match(param: string): boolean {
    return /^\d{4}$/v.test(param);
}
