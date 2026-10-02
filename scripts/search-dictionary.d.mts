export const dictionaryRoot: string;
export function dictionaryFiles(): Promise<string[]>;
export function copySearchDictionary(executableDirectory: string): Promise<void>;
