//
// code to handle drag and drop
//

export async function getDroppedFiles(event: DragEvent): Promise<File[]> {
    event.preventDefault(); // Prevent default behavior, which is the browser opening the files
    let files: File[] = [];
    if (!event.dataTransfer) {
        console.log('No dataTransfer');
        return files;
    }
    for (const item of event.dataTransfer.items) {
        const itemEntry = item.webkitGetAsEntry();
        if (itemEntry !== null && isDirectoryEntry(itemEntry)) {
            const directoryFiles = await getFilesInDirectory(itemEntry);
            files = files.concat(directoryFiles);
        } else if (itemEntry !== null && isFileEntry(itemEntry)) {
            const file = item.getAsFile();
            if (file) {
                files.push(file);
            } else {
                console.log(`There warn't no file in`, item);
            }
        } else {
            console.log(`Unrecognized type of file`, item, itemEntry);
        }
    }
    return files;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
    return entry.isDirectory;
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
    return entry.isFile;
}

/**
 * Get all the File objects in a directory
 */
async function getFilesInDirectory(directory: FileSystemDirectoryEntry): Promise<File[]> {
    const files: File[] = [];
    const entries = await readAllDirectoryEntries(directory);
    for (const entry of entries) {
        if (isFileEntry(entry)) {
            //console.log(`Directory item`, entry);
            const file = await readEntryContentAsync(entry);
            //console.log(`Adding file [${file.name}] of type [${file.type}]`);
            files.push(file);
        } else {
            console.log(`Directory item is not a file`, entry);
        }
    }
    return files;
}

/**
 * Read all the entries in a directory
 */
const readAllDirectoryEntries = async (directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
    const directoryReader = directory.createReader();

    // To read all files in a directory, readEntries needs to be called
    // repeatedly until it returns an empty array.  Chromium-based
    // browsers will only return a max of 100 entries per call
    const entries = [];
    let readEntries = await readEntriesPromise(directoryReader);
    while (readEntries.length > 0) {
        entries.push(...readEntries);
        readEntries = await readEntriesPromise(directoryReader);
    }
    return entries;
};

/**
 * Wrap FileSystemDirectoryReader.readEntries() in a promise to enable using await
 */
const readEntriesPromise = async (directoryReader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
        directoryReader.readEntries(resolve, reject);
    });

/**
 * Wrap FileSystemFileEntry.file() in a promise to enable using await
 */
const readEntryContentAsync = async (entry: FileSystemFileEntry): Promise<File> =>
    new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
